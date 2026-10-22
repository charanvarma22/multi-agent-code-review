import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validReport } from './fixtures/sample-report.js';
import { ReviewReportSchema } from '../src/types/index.js';
import type { RateLimiter } from '../src/utils/rate-limiter.js';

// Mock the Claude Agent SDK so these tests never need real API access
const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

import { CodeReviewOrchestrator } from '../src/orchestrator.js';

interface QueryArgs {
  prompt: string;
  options: {
    mcpServers: Record<string, { type: string; command: string; args: string[] }>;
    agents: Record<string, { model?: string; tools?: string[]; description: string }>;
    allowedTools: string[];
    outputFormat: { type: string };
  };
}

/** Make the mocked query() yield the given messages, like the real async stream */
function mockSdkMessages(messages: unknown[]): void {
  queryMock.mockImplementation(() =>
    (async function* () {
      for (const message of messages) {
        yield message;
      }
    })()
  );
}

const successMessage = { type: 'result', subtype: 'success', structured_output: validReport };

// One attempt, tiny delay: keeps failure-path tests fast
const FAST = { maxRetries: 1, retryDelayMs: 1 };

/**
 * Tests for CodeReviewOrchestrator
 */
describe('CodeReviewOrchestrator', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeInstanceOf(CodeReviewOrchestrator);
      expect(typeof orchestrator.reviewPullRequest).toBe('function');
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        rateLimit: { maxConcurrent: 1, maxRequestsPerMinute: 5, maxTokensPerMinute: 50000 },
      });
      const limiter = (orchestrator as unknown as { rateLimiter: RateLimiter }).rateLimiter;
      const status = limiter.getStatus();
      expect(status.availableRequests).toBe(5);
      expect(status.availableTokens).toBe(50000);
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      mockSdkMessages([successMessage]);
      await new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1);

      const args = queryMock.mock.calls[0][0] as QueryArgs;
      expect(args.prompt).toContain('octocat/Hello-World');
      expect(args.prompt).toContain('#1');
      expect(args.options.mcpServers.github.type).toBe('stdio');
      expect(args.options.mcpServers.github.command).toBe('npx');
      expect(args.options.mcpServers.github.args).toContain('@modelcontextprotocol/server-github');
      expect(args.options.mcpServers.eslint.args).toContain('@eslint/mcp@latest');
      expect(args.options.allowedTools).toContain('mcp__github__*');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      mockSdkMessages([successMessage]);
      await new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1);

      const args = queryMock.mock.calls[0][0] as QueryArgs;
      expect(Object.keys(args.options.agents).sort()).toEqual([
        'code-quality-analyzer',
        'refactoring-suggester',
        'test-coverage-analyzer',
      ]);
      for (const agent of Object.values(args.options.agents)) {
        expect(agent.model).toBe('inherit');
        expect(agent.tools).toContain('Skill');
        expect(agent.description.length).toBeGreaterThan(20);
      }
      // The Task tool is what lets the orchestrator spawn subagents
      expect(args.options.allowedTools).toContain('Task');
      expect(args.prompt).toContain('parallel');
      expect(args.prompt).toContain('code-quality-analyzer');
      expect(args.prompt).toContain('test-coverage-analyzer');
      expect(args.prompt).toContain('refactoring-suggester');
    });

    it('should aggregate results into ReviewReport', async () => {
      mockSdkMessages([successMessage]);
      const report = await new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1);

      expect(report).toEqual(validReport);
      expect(report.fileReviews).toHaveLength(1);
      expect(report.summary.totalFiles).toBe(1);
      expect(report.fileReviews[0].codeQuality.issues.length).toBeGreaterThan(0);
      expect(queryMock.mock.calls[0][0].options.outputFormat.type).toBe('json_schema');
    });

    it('should validate output with Zod schema', async () => {
      // A valid report passes the schema...
      mockSdkMessages([successMessage]);
      const report = await new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);

      // ...and a malformed one is rejected with a clear message
      mockSdkMessages([
        { type: 'result', subtype: 'success', structured_output: { pullRequest: 'not an object' } },
      ]);
      await expect(
        new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1)
      ).rejects.toThrow(/schema validation/);
    });

    it('throws a clear error when the SDK never produces a structured_output', async () => {
      mockSdkMessages([{ type: 'result', subtype: 'success' }]);
      await expect(
        new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1)
      ).rejects.toThrow(/structured_output/);
    });

    it('reports agent failures with the failure type', async () => {
      mockSdkMessages([{ type: 'result', subtype: 'error_max_turns' }]);
      await expect(
        new CodeReviewOrchestrator(FAST).reviewPullRequest('octocat', 'Hello-World', 1)
      ).rejects.toThrow(/error_max_turns/);
    });

    it('retries a failed attempt before giving up', async () => {
      queryMock
        .mockImplementationOnce(() =>
          (async function* () {
            throw new Error('temporary network problem');
          })()
        )
        .mockImplementation(() =>
          (async function* () {
            yield successMessage;
          })()
        );

      const report = await new CodeReviewOrchestrator({ maxRetries: 2, retryDelayMs: 1 }).reviewPullRequest(
        'octocat',
        'Hello-World',
        1
      );
      expect(report).toEqual(validReport);
      expect(queryMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // NOTE: Only run manually with valid API keys:
      // npm run dev -- octocat Hello-World 1
    });
  });
});

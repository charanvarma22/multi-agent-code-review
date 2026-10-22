import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  ReviewReportSchema,
  ReviewReportJSONSchema,
  type ReviewReport,
} from './types/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester,
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { withRetry, withTimeout } from './utils/error-handler.js';
import {
  RateLimiter,
  withRateLimit,
  type RateLimiterConfig,
} from './utils/rate-limiter.js';

/** Rough token estimate for one full multi-agent review (used for rate limiting) */
const ESTIMATED_TOKENS_PER_REVIEW = 20000;

export interface OrchestratorOptions {
  model?: string;
  maxTurns?: number;
  /** Maximum time for a single review attempt (ms) */
  timeoutMs?: number;
  /** Total attempts before giving up */
  maxRetries?: number;
  /** Base delay between retries (ms) */
  retryDelayMs?: number;
  /** Custom rate limit configuration */
  rateLimit?: Partial<RateLimiterConfig>;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model: string | undefined;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL;
    this.maxTurns = options.maxTurns ?? 50;
    this.timeoutMs = options.timeoutMs ?? 600000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.rateLimiter = new RateLimiter(options.rateLimit);
  }

  /**
   * Review a pull request using parallel subagent analysis
   * Wrapped with rate limiting, retry (exponential backoff) and a timeout.
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    return withRateLimit(
      this.rateLimiter,
      () =>
        withRetry(
          () =>
            withTimeout(
              () => this.runReview(owner, repo, prNumber),
              this.timeoutMs,
              `Review of ${owner}/${repo} PR #${prNumber} timed out after ${this.timeoutMs}ms`
            ),
          this.maxRetries,
          this.retryDelayMs
        ),
      ESTIMATED_TOKENS_PER_REVIEW
    );
  }

  /** One review attempt: run the agents and validate the structured output */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const result = query({
      prompt: buildOrchestratorPrompt(owner, repo, prNumber),
      options: {
        model: this.model,
        cwd: process.env.PROJECT_ROOT,
        settingSources: ['project'], // lets agents find .claude/skills
        mcpServers: mcpServersConfig,
        agents: {
          'code-quality-analyzer': codeQualityAnalyzer,
          'test-coverage-analyzer': testCoverageAnalyzer,
          'refactoring-suggester': refactoringSuggester,
        },
        allowedTools: [
          'Task',
          'Skill',
          'Read',
          'Grep',
          'Glob',
          'mcp__github__*',
          'mcp__eslint__*',
        ],
        maxTurns: this.maxTurns,
        permissionMode: 'bypassPermissions',
        outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema },
      },
    });

    for await (const message of result) {
      if (message.type !== 'result') continue;

      if (message.subtype !== 'success') {
        throw new Error(`Agent run failed: ${message.subtype}`);
      }

      if (!message.structured_output) {
        break;
      }

      const parsed = ReviewReportSchema.safeParse(message.structured_output);
      if (!parsed.success) {
        throw new Error(`Report failed schema validation: ${parsed.error.message}`);
      }
      return parsed.data;
    }

    throw new Error('Agent finished without producing a structured_output');
  }
}

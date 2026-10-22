import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { logger, logReviewStart } from './utils/logger.js';
import { ErrorCodes, formatError, isReviewError } from './utils/error-handler.js';
import type { ReviewReport } from './types/index.js';

// Load environment variables
dotenv.config();

const USAGE =
  'Usage: npm run dev -- <owner> <repo> <pr-number>\n' +
  '  Example: npm run dev -- octocat Hello-World 1';

/** Print a friendly error message and exit */
function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/** Validate and parse command-line arguments */
function parseArguments(): { owner: string; repo: string; prNumber: number } {
  const [owner, repo, prStr] = process.argv.slice(2);

  if (!owner || !repo || !prStr) {
    fail(`Missing arguments: owner, repo and PR number are all required.\n\n${USAGE}`);
  }
  if (!/^\d+$/.test(prStr)) {
    fail(`Invalid PR number "${prStr}": it must be a positive whole number.\n\n${USAGE}`);
  }
  const prNumber = parseInt(prStr, 10);
  if (prNumber < 1) {
    fail(`Invalid PR number "${prStr}": it must be 1 or greater.\n\n${USAGE}`);
  }

  return { owner, repo, prNumber };
}

/** Validate authentication and model configuration */
function validateEnvironment(): void {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsKeys = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (hasApiKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else if (hasAwsKeys) {
    if (!process.env.AWS_REGION) {
      fail('AWS Bedrock needs AWS_REGION to be set (for example us-east-1).');
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else {
    fail(
      'No authentication configured. Choose ONE option:\n' +
        '  1) Anthropic API: set ANTHROPIC_API_KEY\n' +
        '  2) AWS Bedrock: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION'
    );
  }

  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      'ANTHROPIC_MODEL is required. Add it to your .env file:\n' +
        '  Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
        '  AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
  }

  if (!process.env.GITHUB_TOKEN) {
    logger.warn(
      'GITHUB_TOKEN is not set. Public repos still work, but you may hit GitHub rate limits.'
    );
  }
}

/** Write the JSON, Markdown and HTML reports into the reports/ directory */
function saveReports(
  report: ReviewReport,
  owner: string,
  repo: string,
  prNumber: number
): { json: string; markdown: string; html: string } {
  const reportsDir = 'reports';
  fs.mkdirSync(reportsDir, { recursive: true });

  const baseName = `${owner}_${repo}_${prNumber}`;
  const files = {
    json: path.join(reportsDir, `${baseName}.json`),
    markdown: path.join(reportsDir, `${baseName}.md`),
    html: path.join(reportsDir, `${baseName}.html`),
  };

  const generator = new ReportGenerator();
  fs.writeFileSync(files.json, generator.generateJSONReport(report), 'utf-8');
  fs.writeFileSync(files.markdown, generator.generateMarkdownReport(report), 'utf-8');
  fs.writeFileSync(files.html, generator.generateHTMLReport(report), 'utf-8');

  return files;
}

/** A short, actionable hint for common failure types */
function hintFor(error: unknown): string | undefined {
  if (!isReviewError(error)) return undefined;
  switch (error.code) {
    case ErrorCodes.AGENT_TIMEOUT:
      return 'The review took too long. Try again, or try a smaller pull request.';
    case ErrorCodes.RATE_LIMITED:
      return 'You hit a rate limit. Wait a minute and try again, and make sure GITHUB_TOKEN is set.';
    case ErrorCodes.RETRY_EXHAUSTED:
      return 'All retry attempts failed. Check your network, credentials and GITHUB_TOKEN, then try again.';
    default:
      return undefined;
  }
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev -- <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const { owner, repo, prNumber } = parseArguments();
  validateEnvironment();

  logger.info(`Starting review of ${owner}/${repo} PR #${prNumber}...`);
  logReviewStart(owner, repo, prNumber);
  const startedAt = Date.now();

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    const files = saveReports(report, owner, repo, prNumber);
    const score = report.summary.overallScore;

    logger.info('Code review completed', {
      owner,
      repo,
      prNumber,
      score,
      duration: Date.now() - startedAt,
      status: 'success',
    });
    logger.info('Review complete. Reports saved:');
    logger.info(`  JSON:     ${files.json}`);
    logger.info(`  Markdown: ${files.markdown}`);
    logger.info(`  HTML:     ${files.html}`);
    logger.info(`  Overall score: ${score}/100`);
  } catch (error) {
    logger.error('Code review failed', {
      owner,
      repo,
      prNumber,
      error: formatError(error),
    });
    console.error(`\n❌ Review failed: ${formatError(error)}`);
    const hint = hintFor(error);
    if (hint) console.error(`   ${hint}`);
    console.error('');
    process.exit(1);
  }
}

main();

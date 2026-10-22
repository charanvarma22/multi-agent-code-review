import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  withTimeout,
  ErrorCodes,
  formatError,
  isReviewError,
  ReviewError,
} from '../src/utils/error-handler.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('withRetry', () => {
  it('returns the result when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after failures and then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockResolvedValue('recovered');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    const error = await withRetry(fn, 3, 1).catch((e: unknown) => e);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(isReviewError(error)).toBe(true);
    expect((error as ReviewError).code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect((error as ReviewError).message).toContain('always fails');
  });

  it('waits longer between each retry (exponential backoff)', async () => {
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    const spy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as typeof setTimeout);

    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await withRetry(fn, 3, 100).catch(() => undefined);
    spy.mockRestore();

    // Two waits happen between three attempts: about 100ms then about 200ms (plus up to 100ms jitter)
    expect(delays.length).toBe(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[0]).toBeLessThan(200);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
    expect(delays[1]).toBeLessThan(300);
  });
});

describe('withTimeout', () => {
  it('returns the result when the function finishes in time', async () => {
    await expect(withTimeout(async () => 'fast', 500)).resolves.toBe('fast');
  });

  it('throws AGENT_TIMEOUT when the function is too slow', async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 200));
    const error = await withTimeout(slow, 20, 'too slow').catch((e: unknown) => e);
    expect(isReviewError(error)).toBe(true);
    expect((error as ReviewError).code).toBe(ErrorCodes.AGENT_TIMEOUT);
    expect((error as ReviewError).message).toBe('too slow');
    expect((error as ReviewError).metadata).toEqual({ timeoutMs: 20 });
  });

  it('passes through errors thrown by the function', async () => {
    await expect(
      withTimeout(async () => {
        throw new Error('inner failure');
      }, 500)
    ).rejects.toThrow('inner failure');
  });
});

describe('formatError', () => {
  it('includes the code for ReviewError', () => {
    expect(formatError(new ReviewError('boom', ErrorCodes.PR_NOT_FOUND))).toBe('[PR_NOT_FOUND] boom');
  });

  it('handles plain errors and non-errors', () => {
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('text')).toBe('text');
  });
});

describe('RateLimiter', () => {
  it('allows a request when nothing has been used', () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10, maxTokensPerMinute: 10000 });
    expect(limiter.canProceed(100)).toBe(true);
  });

  it('tracks requests and tokens in the sliding window', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10, maxTokensPerMinute: 10000 });
    await limiter.acquire(500);
    const status = limiter.getStatus();
    expect(status.activeRequests).toBe(1);
    expect(status.requestsInWindow).toBe(1);
    expect(status.tokensInWindow).toBe(500);
    expect(status.availableRequests).toBe(9);
    expect(status.availableTokens).toBe(9500);
  });

  it('respects the concurrent request limit', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 10, maxTokensPerMinute: 10000 });
    await limiter.acquire(100);
    expect(limiter.canProceed(100)).toBe(false);
    limiter.release();
    expect(limiter.canProceed(100)).toBe(true);
  });

  it('respects the tokens-per-minute limit', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 5, maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 });
    await limiter.acquire(900);
    limiter.release();
    expect(limiter.canProceed(200)).toBe(false);
    expect(limiter.canProceed(100)).toBe(true);
  });

  it('respects the requests-per-minute limit', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 5, maxRequestsPerMinute: 2, maxTokensPerMinute: 100000 });
    await limiter.acquire(10);
    limiter.release();
    await limiter.acquire(10);
    limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
  });

  it('makes a second caller wait until a slot is released', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 10, maxTokensPerMinute: 10000 });
    await limiter.acquire(10);

    let secondAcquired = false;
    const second = limiter.acquire(10).then(() => {
      secondAcquired = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondAcquired).toBe(false);

    limiter.release();
    await second;
    expect(secondAcquired).toBe(true);
  });

  it('updates the token count when actual usage is reported on release', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10, maxTokensPerMinute: 10000 });
    await limiter.acquire(1000);
    limiter.release(250);
    expect(limiter.getStatus().tokensInWindow).toBe(250);
  });
});

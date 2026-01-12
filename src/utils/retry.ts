export interface RetryOptions {
  maxAttempts: number;
  delaysMs: number[];
}

export interface RetryResult<T> {
  success: boolean;
  attempts: number;
  result?: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with specified delays between attempts
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  shouldRetry: (result: T) => boolean,
  options: RetryOptions,
  onAttempt?: (attempt: number, result: T) => void
): Promise<RetryResult<T>> {
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const result = await operation(attempt);
      lastResult = result;

      if (onAttempt) {
        onAttempt(attempt, result);
      }

      if (!shouldRetry(result)) {
        return {
          success: true,
          attempts: attempt,
          result,
        };
      }
    } catch (_error) {
      // Error will be logged by caller if needed
    }

    if (attempt < options.maxAttempts) {
      await sleep(options.delaysMs[attempt - 1]);
    }
  }

  return {
    success: false,
    attempts: options.maxAttempts,
    result: lastResult,
  };
}

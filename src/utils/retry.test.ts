import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry";

describe("retryWithBackoff", () => {
	it("should succeed on first attempt if operation succeeds", async () => {
		const operation = vi.fn().mockResolvedValue("success");
		const shouldRetry = vi.fn().mockReturnValue(false);

		const result = await retryWithBackoff(operation, shouldRetry, {
			maxAttempts: 3,
			delaysMs: [100, 200, 400],
		});

		expect(result.success).toBe(true);
		expect(result.attempts).toBe(1);
		expect(result.result).toBe("success");
		expect(operation).toHaveBeenCalledTimes(1);
		expect(shouldRetry).toHaveBeenCalledWith("success");
	});

	it("should retry when shouldRetry returns true", async () => {
		const operation = vi
			.fn()
			.mockResolvedValueOnce("fail")
			.mockResolvedValueOnce("fail")
			.mockResolvedValueOnce("success");

		const shouldRetry = vi
			.fn()
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false);

		const result = await retryWithBackoff(operation, shouldRetry, {
			maxAttempts: 3,
			delaysMs: [10, 20, 40],
		});

		expect(result.success).toBe(true);
		expect(result.attempts).toBe(3);
		expect(result.result).toBe("success");
		expect(operation).toHaveBeenCalledTimes(3);
	});

	it("should return failure after max attempts", async () => {
		const operation = vi.fn().mockResolvedValue("fail");
		const shouldRetry = vi.fn().mockReturnValue(true);

		const result = await retryWithBackoff(operation, shouldRetry, {
			maxAttempts: 3,
			delaysMs: [10, 20, 40],
		});

		expect(result.success).toBe(false);
		expect(result.attempts).toBe(3);
		expect(result.result).toBe("fail");
		expect(operation).toHaveBeenCalledTimes(3);
	});

	it("should call onAttempt callback for each attempt", async () => {
		const operation = vi
			.fn()
			.mockResolvedValueOnce("attempt1")
			.mockResolvedValueOnce("attempt2");

		const shouldRetry = vi
			.fn()
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false);

		const onAttempt = vi.fn();

		await retryWithBackoff(
			operation,
			shouldRetry,
			{
				maxAttempts: 2,
				delaysMs: [10, 20],
			},
			onAttempt,
		);

		expect(onAttempt).toHaveBeenCalledTimes(2);
		expect(onAttempt).toHaveBeenNthCalledWith(1, 1, "attempt1");
		expect(onAttempt).toHaveBeenNthCalledWith(2, 2, "attempt2");
	});

	it("should handle errors and continue retrying", async () => {
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new Error("error1"))
			.mockRejectedValueOnce(new Error("error2"))
			.mockResolvedValueOnce("success");

		const shouldRetry = vi.fn().mockReturnValue(false);

		const result = await retryWithBackoff(operation, shouldRetry, {
			maxAttempts: 3,
			delaysMs: [10, 20, 40],
		});

		expect(result.success).toBe(true);
		expect(result.attempts).toBe(3);
		expect(result.result).toBe("success");
		expect(operation).toHaveBeenCalledTimes(3);
	});

	it("should pass attempt number to operation", async () => {
		const operation = vi.fn().mockResolvedValue("result");
		const shouldRetry = vi
			.fn()
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false);

		await retryWithBackoff(operation, shouldRetry, {
			maxAttempts: 2,
			delaysMs: [10, 20],
		});

		expect(operation).toHaveBeenNthCalledWith(1, 1);
		expect(operation).toHaveBeenNthCalledWith(2, 2);
	});
});

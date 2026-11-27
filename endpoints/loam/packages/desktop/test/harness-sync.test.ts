/**
 * Unit tests for `pollPageJob` in `harness.ts`: verifies that in-page async calls settle over
 * synchronous `browser.execute` (`POST /execute/sync`), never return a WebDriver-reserved `error`
 * key, surface page failures and navigations cleanly, bound stalled start/poll WebDriver requests,
 * and keep `__loamJobs` clean even when a job completes after timeout or abort (#2656, #2811).
 */
import { describe, expect, it } from 'vitest';
import { type PageJobState, pollPageJob, type ScriptExecutor } from './harness';

interface FakeWindow {
	__loamJobs: Map<number, PageJobState>;
	__loamJobSeq: number;
}

/**
 * Mirrors WebDriver Classic's `isSuccessfulResponse` guard: a plain object with a truthy top-level
 * `error`, `stackTrace`, or `stacktrace` key is misread as a WebDriver protocol error on HTTP 200.
 */
function assertWebDriverSafeValue(value: unknown): void {
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		if (record.error || record.stackTrace || record.stacktrace) {
			throw new Error(
				`WebDriverResponseError: script returned reserved top-level key (${Object.keys(record).join(', ')})`
			);
		}
	}
}

function createFakeBrowser(options: { delayPollMs?: number } = {}) {
	const fakeWindow: FakeWindow = { __loamJobs: new Map(), __loamJobSeq: 0 };
	const execute: ScriptExecutor['execute'] = async (fn, jobId) => {
		if (options.delayPollMs) {
			await new Promise((resolve) => setTimeout(resolve, options.delayPollMs));
		}
		const previous = (globalThis as { window?: unknown }).window;
		(globalThis as { window?: unknown }).window = fakeWindow;
		try {
			const result = fn(jobId);
			assertWebDriverSafeValue(result);
			return result;
		} finally {
			if (previous === undefined) delete (globalThis as { window?: unknown }).window;
			else (globalThis as { window?: unknown }).window = previous;
		}
	};
	return { fakeWindow, browser: { execute } satisfies ScriptExecutor };
}

describe('pollPageJob (sync WebDriver polling)', () => {
	it('resolves once an in-page job settles and removes its slot', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		const value = await pollPageJob(
			browser,
			async () => {
				const id = ++fakeWindow.__loamJobSeq;
				const entry: PageJobState = { status: 'pending' };
				fakeWindow.__loamJobs.set(id, entry);
				setTimeout(() => {
					entry.status = 'done';
					entry.value = '{"success":true}';
				}, 15);
				return id;
			},
			{ label: 'project-list', timeoutMs: 2_000, pollMs: 5 }
		);
		expect(value).toBe('{"success":true}');
		expect(fakeWindow.__loamJobs.size).toBe(0);
	});

	it('throws the in-page failure without using a WebDriver-reserved error key', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		await expect(
			pollPageJob(
				browser,
				async () => {
					const id = ++fakeWindow.__loamJobSeq;
					fakeWindow.__loamJobs.set(id, { status: 'failed', failureMessage: 'boom' });
					return id;
				},
				{ label: 'storedText', timeoutMs: 2_000, pollMs: 5 }
			)
		).rejects.toThrow('boom');
		expect(fakeWindow.__loamJobs.size).toBe(0);
	});

	it('fails fast when a navigation drops the job slot', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		await expect(
			pollPageJob(
				browser,
				async () => {
					const id = ++fakeWindow.__loamJobSeq;
					fakeWindow.__loamJobs.set(id, { status: 'pending' });
					setTimeout(() => {
						fakeWindow.__loamJobs.clear();
					}, 10);
					return id;
				},
				{ label: 'copilot-session-get', timeoutMs: 2_000, pollMs: 5 }
			)
		).rejects.toThrow(/lost its in-page job/);
	});

	it('times out a stalled in-page job and keeps the map empty even after late completion', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		let entry: PageJobState | undefined;
		await expect(
			pollPageJob(
				browser,
				async () => {
					const id = ++fakeWindow.__loamJobSeq;
					entry = { status: 'pending' };
					fakeWindow.__loamJobs.set(id, entry);
					return id;
				},
				{ label: 'copilot-session-get', timeoutMs: 40, pollMs: 5 }
			)
		).rejects.toThrow(/did not settle in the page within 40 ms/);
		expect(fakeWindow.__loamJobs.size).toBe(0);
		// Late in-page settlement mutates the detached entry in place and never re-inserts the deleted id.
		if (entry) {
			entry.status = 'done';
			entry.value = '{"late":true}';
		}
		expect(fakeWindow.__loamJobs.size).toBe(0);
	});

	it('does not call start when the signal is already aborted', async () => {
		const { browser } = createFakeBrowser();
		const controller = new AbortController();
		controller.abort();
		let started = false;
		await expect(
			pollPageJob(
				browser,
				async () => {
					started = true;
					return 1;
				},
				{ label: 'copilot-session-get', timeoutMs: 5_000, pollMs: 5, signal: controller.signal }
			)
		).rejects.toThrow(/aborted before starting/);
		expect(started).toBe(false);
	});

	it('stops polling and cleans up when aborted by the caller', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 15);
		await expect(
			pollPageJob(
				browser,
				async () => {
					const id = ++fakeWindow.__loamJobSeq;
					fakeWindow.__loamJobs.set(id, { status: 'pending' });
					return id;
				},
				{ label: 'copilot-session-get', timeoutMs: 5_000, pollMs: 5, signal: controller.signal }
			)
		).rejects.toThrow(/aborted while/);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(fakeWindow.__loamJobs.size).toBe(0);
	});

	it('bounds a stalled start request within timeoutMs and cleans up a late job id', async () => {
		const { fakeWindow, browser } = createFakeBrowser();
		let resolveStart!: (id: number) => void;
		const pendingStart = new Promise<number>((resolve) => {
			resolveStart = resolve;
		});
		await expect(
			pollPageJob(browser, () => pendingStart, {
				label: 'copilot-message-send',
				timeoutMs: 40,
				pollMs: 5,
			})
		).rejects.toThrow(/timed out waiting on WebDriver start after 40 ms/);
		const lateId = ++fakeWindow.__loamJobSeq;
		fakeWindow.__loamJobs.set(lateId, { status: 'pending' });
		resolveStart(lateId);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(fakeWindow.__loamJobs.size).toBe(0);
	});

	it('bounds a stalled poll execute request within timeoutMs', async () => {
		const { fakeWindow, browser } = createFakeBrowser({ delayPollMs: 250 });
		await expect(
			pollPageJob(
				browser,
				async () => {
					const id = ++fakeWindow.__loamJobSeq;
					fakeWindow.__loamJobs.set(id, { status: 'pending' });
					return id;
				},
				{ label: 'copilot-session-get', timeoutMs: 40, pollMs: 5 }
			)
		).rejects.toThrow(/timed out waiting on WebDriver poll after 40 ms/);
	});
});

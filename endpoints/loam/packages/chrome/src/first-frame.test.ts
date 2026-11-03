import { describe, expect, it, vi } from 'vitest';
import { afterFirstFrame } from './first-frame.js';

describe('afterFirstFrame', () => {
	it('resolves after two animation frames', async () => {
		const frames: Array<() => void> = [];
		const view = {
			requestAnimationFrame: (callback: () => void) => frames.push(callback),
			setTimeout: () => 0,
		} as unknown as Window;
		let done = false;
		const after = afterFirstFrame(view).then(() => {
			done = true;
		});
		frames.shift()?.();
		await Promise.resolve();
		expect(done).toBe(false);
		frames.shift()?.();
		await after;
		expect(done).toBe(true);
	});

	it('resolves from its timer in a hidden tab, which fires no frame', async () => {
		vi.useFakeTimers();
		const view = {
			requestAnimationFrame: () => 0,
			setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
		} as unknown as Window;
		const after = afterFirstFrame(view);
		await vi.advanceTimersByTimeAsync(300);
		await after;
		vi.useRealTimers();
	});
});

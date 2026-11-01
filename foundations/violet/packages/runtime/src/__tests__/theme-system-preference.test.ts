import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VioletRuntime } from '../client.js';
import { ThemeManager } from '../theme.js';
import type { Theme } from '../types.js';

const THEMES: Theme[] = [
	{ nodeId: 'brand-light', name: 'Light' },
	{ nodeId: 'brand-dark', name: 'Dark' },
];

function makeRuntime(): VioletRuntime {
	return {
		getCurrentNodeId: vi.fn(() => 'brand-light'),
		load: vi.fn(() => Promise.resolve([])),
		switchNode: vi.fn(() => Promise.resolve([])),
		preload: vi.fn(() => Promise.resolve()),
	} as unknown as VioletRuntime;
}

/** A controllable prefers-color-scheme media query. */
function fakeMediaQuery(matches: boolean) {
	const listeners = new Set<(event: { matches: boolean }) => void>();
	const query = {
		matches,
		media: '(prefers-color-scheme: dark)',
		addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => {
			listeners.add(listener);
		}),
		removeEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => {
			listeners.delete(listener);
		}),
		change(next: boolean) {
			query.matches = next;
			for (const listener of listeners) listener({ matches: next });
		},
		get listenerCount() {
			return listeners.size;
		},
	};
	return query;
}

/** Let fire-and-forget switch() calls (and their zero-length transition delay) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('ThemeManager.useSystemPreference()', () => {
	let runtime: VioletRuntime;
	let manager: ThemeManager;
	const originalMatchMedia = window.matchMedia;

	beforeEach(() => {
		runtime = makeRuntime();
		manager = new ThemeManager(runtime, {
			themes: THEMES,
			defaultTheme: 'brand-light',
			transitionDuration: 0,
		});
	});

	afterEach(() => {
		window.matchMedia = originalMatchMedia;
		vi.restoreAllMocks();
	});

	it('applies the dark theme immediately when the system prefers dark', async () => {
		const query = fakeMediaQuery(true);
		window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;

		manager.useSystemPreference('brand-light', 'brand-dark');
		await settle();

		expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
		expect(runtime.switchNode).toHaveBeenCalledWith('brand-dark');
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
	});

	it('stays on the light theme when the system prefers light', async () => {
		const query = fakeMediaQuery(false);
		window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;

		manager.useSystemPreference('brand-light', 'brand-dark');
		await settle();

		// Already on brand-light: switch() is a no-op, so the runtime is not asked to switch.
		expect(runtime.switchNode).not.toHaveBeenCalled();
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
	});

	it('follows later system changes until unsubscribed', async () => {
		const query = fakeMediaQuery(false);
		window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
		const changes = vi.fn();
		manager.onChange((theme) => changes(theme.nodeId));

		const stop = manager.useSystemPreference('brand-light', 'brand-dark');
		query.change(true);
		await settle();
		query.change(false);
		await settle();

		expect(changes.mock.calls).toEqual([['brand-dark'], ['brand-light']]);

		stop();
		expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
		expect(query.listenerCount).toBe(0);
		query.change(true);
		await settle();
		expect(changes).toHaveBeenCalledTimes(2);
	});

	it('logs, rather than throws, when a system-driven switch fails', async () => {
		const query = fakeMediaQuery(true);
		window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
		const failure = new Error('network down');
		vi.mocked(runtime.switchNode).mockRejectedValueOnce(failure);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(() => manager.useSystemPreference('brand-light', 'brand-dark')).not.toThrow();
		await settle();

		expect(consoleError).toHaveBeenCalledWith(failure);
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
	});

	it('logs when the system theme is not registered', async () => {
		const query = fakeMediaQuery(true);
		window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		manager.useSystemPreference('brand-light', 'brand-dim');
		await settle();

		expect(consoleError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'Theme not found: brand-dim' }),
		);
	});

	it('returns a no-op unsubscribe when matchMedia is unavailable', () => {
		window.matchMedia = undefined as unknown as typeof window.matchMedia;

		const stop = manager.useSystemPreference('brand-light', 'brand-dark');

		expect(() => stop()).not.toThrow();
		expect(runtime.switchNode).not.toHaveBeenCalled();
	});
});

describe('ThemeManager options and listeners', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		document.documentElement.className = '';
	});

	it('uses a custom transition class for the configured duration', async () => {
		vi.useFakeTimers();
		const manager = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			transitionClass: 'fading',
			transitionDuration: 300,
		});

		const pending = manager.switch('brand-dark');
		await vi.advanceTimersByTimeAsync(0);
		expect(document.documentElement.classList.contains('fading')).toBe(true);
		expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);

		await vi.advanceTimersByTimeAsync(299);
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');

		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(document.documentElement.classList.contains('fading')).toBe(false);
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
	});

	it('persists the chosen theme and restores it in a new manager', async () => {
		localStorage.removeItem('violet-theme');
		const first = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			storageKey: 'violet-theme',
			transitionDuration: 0,
		});
		await first.switch('brand-dark');

		const second = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			storageKey: 'violet-theme',
		});

		expect(localStorage.getItem('violet-theme')).toBe('brand-dark');
		expect(second.getSavedTheme()).toBe('brand-dark');
		expect(second.getCurrentTheme()?.nodeId).toBe('brand-dark');
		localStorage.removeItem('violet-theme');
	});

	it('does not read or write storage without a storageKey', async () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem');
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const manager = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			transitionDuration: 0,
		});

		await manager.switch('brand-dark');

		expect(manager.getSavedTheme()).toBeNull();
		expect(getItem).not.toHaveBeenCalled();
		expect(setItem).not.toHaveBeenCalled();
	});

	it('works without localStorage at all (non-browser hosts)', async () => {
		vi.stubGlobal('localStorage', undefined);
		const manager = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			storageKey: 'violet-theme',
			transitionDuration: 0,
		});

		expect(manager.getSavedTheme()).toBeNull();
		await manager.switch('brand-dark');
		await manager.apply('brand-light');

		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
	});

	it('has no current theme when the default is not registered', () => {
		const manager = new ThemeManager(makeRuntime(), { themes: THEMES, defaultTheme: 'missing' });
		expect(manager.getCurrentTheme()).toBeNull();
	});

	it('toggle() from the second theme goes back to the first', async () => {
		const runtime = makeRuntime();
		const manager = new ThemeManager(runtime, {
			themes: THEMES,
			defaultTheme: 'brand-dark',
			transitionDuration: 0,
		});

		await manager.toggle('brand-light', 'brand-dark');

		expect(runtime.switchNode).toHaveBeenCalledWith('brand-light');
		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
	});

	it('a throwing onChange listener does not stop the switch or other listeners', async () => {
		const manager = new ThemeManager(makeRuntime(), {
			themes: THEMES,
			defaultTheme: 'brand-light',
			transitionDuration: 0,
		});
		const second = vi.fn();
		manager.onChange(() => {
			throw new Error('listener bug');
		});
		manager.onChange(second);

		await expect(manager.switch('brand-dark')).resolves.toBeUndefined();
		expect(second).toHaveBeenCalledWith(THEMES[1]);
	});

	it('a superseded apply() leaves the newer theme in place', async () => {
		const runtime = makeRuntime();
		let releaseFirst!: () => void;
		vi.mocked(runtime.switchNode)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = () => resolve([]);
					}),
			)
			.mockResolvedValueOnce([]);
		vi.mocked(runtime.getCurrentNodeId).mockReturnValue('other');
		const manager = new ThemeManager(runtime, { themes: THEMES, defaultTheme: 'brand-light' });
		const notified = vi.fn();
		manager.onChange((theme) => notified(theme.nodeId));

		const slow = manager.apply('brand-light');
		await manager.apply('brand-dark');
		releaseFirst();
		await slow;

		expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
		expect(notified.mock.calls).toEqual([['brand-dark']]);
	});
});

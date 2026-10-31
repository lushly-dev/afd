import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VioletRuntime } from '../client.js';
import { ThemeManager } from '../theme.js';

const THEMES = [
	{ nodeId: 'brand-light', name: 'Light' },
	{ nodeId: 'brand-dark', name: 'Dark' },
];

function makeRuntime(overrides: Record<string, unknown> = {}) {
	return {
		getCurrentNodeId: vi.fn(() => 'brand-light'),
		load: vi.fn(() => Promise.resolve([])),
		switchNode: vi.fn(() => Promise.resolve([])),
		preload: vi.fn(() => Promise.resolve()),
		...overrides,
	} as unknown as VioletRuntime;
}

const html = () => document.documentElement;

describe('ThemeManager robustness', () => {
	beforeEach(() => {
		localStorage.clear();
		html().classList.remove('theme-transitioning');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('switch() failure', () => {
		it('removes the transition class when switchNode rejects', async () => {
			const runtime = makeRuntime({
				switchNode: vi.fn(() => Promise.reject(new Error('network down'))),
			});
			const manager = new ThemeManager(runtime, {
				themes: THEMES,
				defaultTheme: 'brand-light',
				transitionDuration: 0,
			});

			await expect(manager.switch('brand-dark')).rejects.toThrow('network down');

			expect(html().classList.contains('theme-transitioning')).toBe(false);
			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
		});

		it('keeps the class while a newer switch is still in flight', async () => {
			let releaseFirst!: () => void;
			const switchNode = vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<void>((r) => {
							releaseFirst = r;
						}),
				)
				.mockImplementationOnce(() => new Promise(() => {})); // second never settles
			const manager = new ThemeManager(makeRuntime({ switchNode }), {
				themes: [...THEMES, { nodeId: 'third', name: 'Third' }],
				defaultTheme: 'brand-light',
				transitionDuration: 0,
			});

			const first = manager.switch('brand-dark');
			void manager.switch('third');
			releaseFirst();
			await first;

			expect(html().classList.contains('theme-transitioning')).toBe(true);
			// ...and the superseded switch did not overwrite state
			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
		});
	});

	describe('stale saved theme', () => {
		it('falls back to the default theme when the saved theme is unknown', () => {
			localStorage.setItem('theme', 'deleted-theme');
			const manager = new ThemeManager(makeRuntime(), {
				themes: THEMES,
				defaultTheme: 'brand-dark',
				storageKey: 'theme',
			});
			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
		});

		it('still uses a valid saved theme', () => {
			localStorage.setItem('theme', 'brand-dark');
			const manager = new ThemeManager(makeRuntime(), {
				themes: THEMES,
				defaultTheme: 'brand-light',
				storageKey: 'theme',
			});
			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
		});
	});

	describe('blocked localStorage', () => {
		// Browsers with storage blocked throw a SecurityError on *access* to localStorage.
		const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

		function blockStorage() {
			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				get() {
					throw new DOMException('denied', 'SecurityError');
				},
			});
		}

		afterEach(() => {
			if (original) Object.defineProperty(globalThis, 'localStorage', original);
		});

		it('does not throw from the constructor or getSavedTheme', () => {
			blockStorage();
			let manager!: ThemeManager;
			expect(() => {
				manager = new ThemeManager(makeRuntime(), {
					themes: THEMES,
					defaultTheme: 'brand-light',
					storageKey: 'theme',
				});
			}).not.toThrow();
			expect(manager.getSavedTheme()).toBeNull();
			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-light');
		});

		it('still switches and notifies when saving the preference throws', async () => {
			blockStorage();
			const manager = new ThemeManager(makeRuntime(), {
				themes: THEMES,
				defaultTheme: 'brand-light',
				storageKey: 'theme',
				transitionDuration: 0,
			});
			const listener = vi.fn();
			manager.onChange(listener);

			await manager.switch('brand-dark');

			expect(manager.getCurrentTheme()?.nodeId).toBe('brand-dark');
			expect(listener).toHaveBeenCalledOnce();
		});

		it('apply() works with blocked storage', async () => {
			blockStorage();
			const manager = new ThemeManager(makeRuntime(), {
				themes: THEMES,
				defaultTheme: 'brand-light',
				storageKey: 'theme',
			});
			await expect(manager.apply('brand-light')).resolves.toBeUndefined();
		});
	});
});

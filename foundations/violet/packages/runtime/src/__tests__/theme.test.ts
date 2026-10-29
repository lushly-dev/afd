import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VioletRuntime } from '../client.js';
import { ThemeManager } from '../theme.js';

describe('ThemeManager', () => {
	let mockRuntime: VioletRuntime;
	let themes: ThemeManager;

	beforeEach(() => {
		// Mock the runtime
		mockRuntime = {
			getCurrentNodeId: vi.fn(() => 'brand-light'),
			load: vi.fn(() => Promise.resolve([])),
			switchNode: vi.fn(() => Promise.resolve([])),
			preload: vi.fn(() => Promise.resolve()),
		} as unknown as VioletRuntime;

		themes = new ThemeManager(mockRuntime, {
			themes: [
				{ nodeId: 'brand-light', name: 'Light Theme' },
				{ nodeId: 'brand-dark', name: 'Dark Theme' },
				{ nodeId: 'brand-high-contrast', name: 'High Contrast' },
			],
			defaultTheme: 'brand-light',
		});
	});

	describe('getThemes()', () => {
		it('should return all registered themes', () => {
			const allThemes = themes.getThemes();
			expect(allThemes).toHaveLength(3);
			expect(allThemes.map((t) => t.nodeId)).toContain('brand-light');
			expect(allThemes.map((t) => t.nodeId)).toContain('brand-dark');
		});
	});

	describe('getCurrentTheme()', () => {
		it('should return default theme initially', () => {
			const current = themes.getCurrentTheme();
			expect(current).not.toBeNull();
			expect(current?.nodeId).toBe('brand-light');
			expect(current?.name).toBe('Light Theme');
		});
	});

	describe('apply()', () => {
		it('should load theme via runtime', async () => {
			await themes.apply('brand-dark');

			expect(mockRuntime.switchNode).toHaveBeenCalledWith('brand-dark');
			expect(themes.getCurrentTheme()?.nodeId).toBe('brand-dark');
		});

		it('should throw for unknown theme', async () => {
			await expect(themes.apply('unknown-theme')).rejects.toThrow('Theme not found');
		});

		it('should call load if already on correct node', async () => {
			vi.mocked(mockRuntime.getCurrentNodeId).mockReturnValue('brand-light');

			await themes.apply('brand-light');

			expect(mockRuntime.load).toHaveBeenCalled();
			expect(mockRuntime.switchNode).not.toHaveBeenCalled();
		});
	});

	describe('switch()', () => {
		it('should switch theme via runtime', async () => {
			await themes.switch('brand-dark');

			expect(mockRuntime.switchNode).toHaveBeenCalledWith('brand-dark');
			expect(themes.getCurrentTheme()?.nodeId).toBe('brand-dark');
		});

		it('should not switch if already on theme', async () => {
			// Set current theme to dark
			await themes.apply('brand-dark');
			vi.clearAllMocks();

			// Try to switch to dark again
			await themes.switch('brand-dark');

			expect(mockRuntime.switchNode).not.toHaveBeenCalled();
		});

		it('should throw for unknown theme', async () => {
			await expect(themes.switch('unknown')).rejects.toThrow('Theme not found');
		});
	});

	describe('toggle()', () => {
		it('should toggle between two themes', async () => {
			// Start on light
			expect(themes.getCurrentTheme()?.nodeId).toBe('brand-light');

			// Toggle to dark
			await themes.toggle('brand-light', 'brand-dark');
			expect(themes.getCurrentTheme()?.nodeId).toBe('brand-dark');

			// Toggle back to light
			await themes.toggle('brand-light', 'brand-dark');
			expect(themes.getCurrentTheme()?.nodeId).toBe('brand-light');
		});
	});

	describe('preload()', () => {
		it('should preload a theme', async () => {
			await themes.preload('brand-dark');
			expect(mockRuntime.preload).toHaveBeenCalledWith('brand-dark');
		});

		it('should throw for unknown theme', async () => {
			await expect(themes.preload('unknown')).rejects.toThrow('Theme not found');
		});
	});

	describe('preloadAll()', () => {
		it('should preload all themes', async () => {
			await themes.preloadAll();

			expect(mockRuntime.preload).toHaveBeenCalledTimes(3);
			expect(mockRuntime.preload).toHaveBeenCalledWith('brand-light');
			expect(mockRuntime.preload).toHaveBeenCalledWith('brand-dark');
			expect(mockRuntime.preload).toHaveBeenCalledWith('brand-high-contrast');
		});
	});

	describe('onChange()', () => {
		it('should notify listeners on theme change', async () => {
			const listener = vi.fn();
			themes.onChange(listener);

			await themes.switch('brand-dark');

			expect(listener).toHaveBeenCalledWith(
				expect.objectContaining({
					nodeId: 'brand-dark',
					name: 'Dark Theme',
				}),
			);
		});

		it('should return unsubscribe function', async () => {
			const listener = vi.fn();
			const unsubscribe = themes.onChange(listener);

			await themes.switch('brand-dark');
			expect(listener).toHaveBeenCalledOnce();

			unsubscribe();
			await themes.switch('brand-high-contrast');
			expect(listener).toHaveBeenCalledOnce(); // Still 1
		});
	});
});

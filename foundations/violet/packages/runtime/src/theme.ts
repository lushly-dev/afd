/**
 * Theme Manager
 *
 * Manages theme switching with preloading and transitions.
 */

import type { VioletRuntime } from './client.js';
import type { Theme } from './types.js';

/**
 * Theme Manager options
 */
export interface ThemeManagerOptions {
	/** Available themes */
	themes: Theme[];

	/** Default theme node ID */
	defaultTheme: string;

	/** Storage key for persisting theme preference */
	storageKey?: string;

	/** Transition duration in ms (default: 200) */
	transitionDuration?: number;

	/** CSS class added during theme transitions */
	transitionClass?: string;
}

/**
 * ThemeManager - Manages theme switching with smooth transitions.
 *
 * @example
 * ```ts
 * const violet = new VioletRuntime({ nodeId: "brand-light" });
 * await violet.load();
 *
 * const themes = new ThemeManager(violet, {
 *   themes: [
 *     { nodeId: "brand-light", name: "Light" },
 *     { nodeId: "brand-dark", name: "Dark" },
 *   ],
 *   defaultTheme: "brand-light",
 *   storageKey: "preferred-theme",
 * });
 *
 * // Get saved preference or default
 * const initial = themes.getSavedTheme();
 * await themes.apply(initial);
 *
 * // Switch theme
 * await themes.switch("brand-dark");
 *
 * // Preload for instant switching
 * await themes.preloadAll();
 * ```
 */
export class ThemeManager {
	private runtime: VioletRuntime;
	private themes: Map<string, Theme> = new Map();
	private currentTheme: Theme | null = null;
	private storageKey: string | null;
	private transitionDuration: number;
	private transitionClass: string;
	private listeners: Set<(theme: Theme) => void> = new Set();
	/** Incremented by every apply()/switch(); only the latest request updates state. */
	private requestSeq = 0;
	/** Number of in-flight transitions holding the transition class on <html>. */
	private activeTransitions = 0;

	constructor(runtime: VioletRuntime, options: ThemeManagerOptions) {
		this.runtime = runtime;
		this.storageKey = options.storageKey ?? null;
		this.transitionDuration = options.transitionDuration ?? 200;
		this.transitionClass = options.transitionClass ?? 'theme-transitioning';

		// Register themes
		for (const theme of options.themes) {
			this.themes.set(theme.nodeId, theme);
		}

		// Set initial theme from storage or default
		// A stale saved preference (theme no longer registered) falls back to the default.
		const saved = this.getSavedTheme();
		this.currentTheme =
			(saved ? this.themes.get(saved) : undefined) ?? this.themes.get(options.defaultTheme) ?? null;
	}

	/**
	 * Get all available themes.
	 */
	getThemes(): Theme[] {
		return Array.from(this.themes.values());
	}

	/**
	 * Get current theme.
	 */
	getCurrentTheme(): Theme | null {
		return this.currentTheme;
	}

	/**
	 * Get saved theme preference from storage.
	 */
	getSavedTheme(): string | null {
		if (!this.storageKey) return null;
		try {
			// Even touching `localStorage` can throw (SecurityError) when storage is blocked.
			if (typeof localStorage === 'undefined') return null;
			return localStorage.getItem(this.storageKey);
		} catch {
			return null;
		}
	}

	/**
	 * Save theme preference to storage (best-effort).
	 */
	private saveTheme(nodeId: string): void {
		if (!this.storageKey) return;
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(this.storageKey, nodeId);
		} catch {
			// Storage blocked or full - the preference simply isn't persisted.
		}
	}

	/**
	 * Apply a theme (initial load).
	 */
	async apply(nodeId: string): Promise<void> {
		const theme = this.themes.get(nodeId);
		if (!theme) {
			throw new Error(`Theme not found: ${nodeId}`);
		}

		const seq = ++this.requestSeq;

		if (this.runtime.getCurrentNodeId() !== nodeId) {
			await this.runtime.switchNode(nodeId);
		} else {
			await this.runtime.load();
		}

		// A newer apply()/switch() superseded this one: leave its state alone.
		if (seq !== this.requestSeq) return;

		this.currentTheme = theme;
		this.saveTheme(nodeId);
		this.notifyListeners(theme);
	}

	/**
	 * Switch to a different theme with transition.
	 */
	async switch(nodeId: string): Promise<void> {
		const theme = this.themes.get(nodeId);
		if (!theme) {
			throw new Error(`Theme not found: ${nodeId}`);
		}

		if (this.currentTheme?.nodeId === nodeId) {
			return; // Already on this theme
		}

		const seq = ++this.requestSeq;

		// Add transition class (removed in `finally`, even if the switch fails)
		if (typeof document !== 'undefined') {
			document.documentElement.classList.add(this.transitionClass);
		}
		this.activeTransitions++;

		try {
			// Switch tokens
			await this.runtime.switchNode(nodeId);

			// Wait for transition duration
			await this.delay(this.transitionDuration);
		} finally {
			this.activeTransitions--;
			if (this.activeTransitions === 0 && typeof document !== 'undefined') {
				document.documentElement.classList.remove(this.transitionClass);
			}
		}

		// A newer apply()/switch() superseded this one: leave its state alone.
		if (seq !== this.requestSeq) return;

		this.currentTheme = theme;
		this.saveTheme(nodeId);
		this.notifyListeners(theme);
	}

	/**
	 * Toggle between two themes.
	 */
	async toggle(themeA: string, themeB: string): Promise<void> {
		const nextTheme = this.currentTheme?.nodeId === themeA ? themeB : themeA;
		await this.switch(nextTheme);
	}

	/**
	 * Preload a specific theme.
	 */
	async preload(nodeId: string): Promise<void> {
		if (!this.themes.has(nodeId)) {
			throw new Error(`Theme not found: ${nodeId}`);
		}
		await this.runtime.preload(nodeId);
	}

	/**
	 * Preload all themes.
	 */
	async preloadAll(): Promise<void> {
		const preloads = Array.from(this.themes.keys()).map((nodeId) => this.runtime.preload(nodeId));
		await Promise.all(preloads);
	}

	/**
	 * Subscribe to theme changes.
	 */
	onChange(listener: (theme: Theme) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Set up system preference detection (prefers-color-scheme).
	 */
	useSystemPreference(lightTheme: string, darkTheme: string): () => void {
		if (typeof window === 'undefined' || !window.matchMedia) {
			return () => {};
		}

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		const handler = (e: MediaQueryListEvent | MediaQueryList) => {
			const theme = e.matches ? darkTheme : lightTheme;
			this.switch(theme).catch(console.error);
		};

		// Set initial theme based on system preference
		handler(mediaQuery);

		// Listen for changes
		mediaQuery.addEventListener('change', handler);

		return () => {
			mediaQuery.removeEventListener('change', handler);
		};
	}

	/**
	 * Notify listeners of theme change.
	 */
	private notifyListeners(theme: Theme): void {
		for (const listener of this.listeners) {
			try {
				listener(theme);
			} catch {
				// Don't let listener errors break the manager
			}
		}
	}

	/**
	 * Delay helper.
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

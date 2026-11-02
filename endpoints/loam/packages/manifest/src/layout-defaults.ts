/**
 * @fileoverview The layout bounds, in a module of their own: the kernel's first-paint chunk needs them,
 * and a module is split whole, so they must not carry the catalogs in with them (phase 1 specification,
 * 9.2).
 */

/** The bounds {@link LAYOUT_DEFAULTS_V0} holds, in CSS pixels. */
export interface LayoutDefaultsV0 {
	readonly sidebar: { readonly default: 260; readonly min: 200; readonly max: 480 };
	readonly inspector: { readonly default: 300; readonly min: 240; readonly max: 520 };
	readonly panel: { readonly default: 240; readonly min: 120 };
	readonly mainMin: 360;
}

/**
 * Sizes in CSS pixels. The theme's `shell.size.*` tokens hold the same values, and the theme
 * package's `theme:check` fails when they disagree.
 */
export const LAYOUT_DEFAULTS_V0: LayoutDefaultsV0 = {
	sidebar: { default: 260, min: 200, max: 480 },
	inspector: { default: 300, min: 240, max: 520 },
	panel: { default: 240, min: 120 },
	mainMin: 360,
};

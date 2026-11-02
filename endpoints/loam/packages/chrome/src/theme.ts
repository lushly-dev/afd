/**
 * @fileoverview Theme application (phase 0 specification, section 7): `loam-theme.css` through
 * `adoptedStyleSheets`, and `data-loam-theme` and `data-loam-density` on the document element from
 * `appearance-get`. No `<style>` element and no style attribute, so `style-src 'self'` holds.
 */

import { css } from '@lushly-dev/fast-element';
import type { AppearanceV0, ResolvedThemeV0 } from '@lushly-dev/loam-kernel';

/** The document's own rules: the page surface, its text and the color scheme per theme. */
export const documentStyles = css`
	html {
		color-scheme: light;
		background: var(--color-surface-page);
		color: var(--color-text-primary);
	}
	html[data-loam-theme='dark'] {
		color-scheme: dark;
	}
	body {
		margin: 0;
	}
`;

const applied = new WeakMap<Document, CSSStyleSheet>();

/**
 * Adopt the theme stylesheet (the text of `@lushly-dev/loam-theme/loam-theme.css`) and the
 * document's own rules once per document.
 */
export function applyThemeStylesheet(doc: Document, themeCss: string): void {
	if (applied.has(doc)) return;
	const sheet = new (doc.defaultView ?? window).CSSStyleSheet();
	sheet.replaceSync(themeCss);
	applied.set(doc, sheet);
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	documentStyles.addStylesTo(doc);
}

/**
 * The theme the document shows. Under forced colors it is high contrast whatever the setting,
 * and the system colors win (6.3).
 */
export function displayedTheme(appearance: AppearanceV0, forcedColors: boolean): ResolvedThemeV0 {
	return forcedColors ? 'high-contrast' : appearance.resolved;
}

/** Set `data-loam-theme` and `data-loam-density` from `appearance-get`'s result. */
export function applyAppearance(
	doc: Document,
	appearance: AppearanceV0,
	forcedColors: boolean
): void {
	const root = doc.documentElement;
	root.dataset.loamTheme = displayedTheme(appearance, forcedColors);
	if (appearance.density === 'compact') root.dataset.loamDensity = 'compact';
	else delete root.dataset.loamDensity;
}

/**
 * violet-elements' built-in theme, light or dark from the system setting, applied as an adopted
 * stylesheet (no inline style element), as health-dashboard does.
 */
import { violetThemeCssText } from '@lushly-dev/violet-elements/dist/theme/violet-theme-builtin.js';
import { applyVioletThemePreset } from '@lushly-dev/violet-elements/dist/theme/violet-theme-runtime.js';

export function applyTheme(doc: Document = document, view: Window = window): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(violetThemeCssText);
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	const dark = view.matchMedia('(prefers-color-scheme: dark)');
	const apply = () => applyVioletThemePreset(doc, dark.matches ? 'dark' : 'light');
	apply();
	dark.addEventListener('change', apply);
}

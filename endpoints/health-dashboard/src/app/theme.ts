/**
 * violet-elements' built-in runtime theme, applied without an inline `<style>` element
 * so the page's Content Security Policy can forbid inline styles. Violet's token engine
 * is not used; it remains an optional composition (see README).
 */
import { applyVioletThemePreset, violetThemeCssText } from '@lushly-dev/violet-elements';

export function applyTheme(doc: Document = document, view: Window = window): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(violetThemeCssText);
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	const dark = view.matchMedia('(prefers-color-scheme: dark)');
	const apply = () => applyVioletThemePreset(doc, dark.matches ? 'dark' : 'light');
	apply();
	dark.addEventListener('change', apply);
}

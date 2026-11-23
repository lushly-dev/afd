/**
 * violet-elements' built-in theme, light or dark from the system setting, applied as an adopted
 * stylesheet (no inline style element). Built from the package's public `theme-css` and token
 * export entries so the bundle keeps only the elements `elements.ts` registers.
 */
import {
	createVioletThemeCss,
	VIOLET_THEME_PRESET_ATTRIBUTE,
} from '@lushly-dev/violet-elements/theme-css';
import violetThemeExport from '@lushly-dev/violet-elements/tokens/violet-theme.export.json' with {
	type: 'json',
};

const violetThemeCssText = createVioletThemeCss({
	defaultPreset: 'light',
	presets: violetThemeExport.presets,
});

export function applyTheme(doc: Document = document, view: Window = window): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(violetThemeCssText);
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	const dark = view.matchMedia('(prefers-color-scheme: dark)');
	const apply = () =>
		doc.documentElement.setAttribute(
			VIOLET_THEME_PRESET_ATTRIBUTE,
			dark.matches ? 'dark' : 'light'
		);
	apply();
	dark.addEventListener('change', apply);
}

/**
 * violet-elements' built-in AFD theme, light or dark from the system setting. Imported from the
 * `theme-runtime` entry so the built-in values arrive in a chunk of their own.
 */
import {
	applyVioletThemePreset,
	installVioletTheme,
	loadVioletBuiltInTheme,
} from '@lushly-dev/violet-elements/theme-runtime';

/** Installs the theme and resolves once its values apply, or once loading them fails. */
export async function applyTheme(doc: Document = document, view: Window = window): Promise<void> {
	installVioletTheme(doc);
	const dark = view.matchMedia('(prefers-color-scheme: dark)');
	const apply = () => applyVioletThemePreset(doc, dark.matches ? 'dark' : 'light');
	apply();
	dark.addEventListener('change', apply);
	await loadVioletBuiltInTheme().catch(() => {
		// violet-elements' runtime has already logged the failure. The components keep their light
		// fallbacks; the page's own styles fall back to plain values (styles.css).
	});
}

/**
 * violet-elements' built-in runtime theme, light or dark from the system setting.
 * `installVioletTheme()` adopts a constructed stylesheet and writes no inline `<style>`
 * element, so the page's Content Security Policy can forbid inline styles. Violet's token
 * engine is not used; it remains an optional composition (see README).
 */
import {
	applyVioletThemePreset,
	installVioletTheme,
	loadVioletBuiltInTheme,
} from '@lushly-dev/violet-elements';

/**
 * Installs the theme and resolves once its values are applied, so the first paint is themed. It
 * resolves too when the built-in values' chunk fails to load: the page starts on the components'
 * literal fallbacks, and the next install retries the chunk.
 */
export async function applyTheme(doc: Document = document, view: Window = window): Promise<void> {
	installVioletTheme(doc);
	const dark = view.matchMedia('(prefers-color-scheme: dark)');
	const apply = () => applyVioletThemePreset(doc, dark.matches ? 'dark' : 'light');
	apply();
	dark.addEventListener('change', apply);
	await loadVioletBuiltInTheme().catch(() => {
		// Not swallowed unseen: violet-elements' runtime has already logged this failure.
	});
}

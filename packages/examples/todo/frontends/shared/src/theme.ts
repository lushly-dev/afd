/**
 * violet-elements' built-in theme, light or dark from the system setting. `installVioletTheme()`
 * adopts a constructed stylesheet (no inline style element). Imported from the package's
 * `theme-runtime` entry, not its root, so the bundle keeps only the elements `elements.ts`
 * registers and the built-in values arrive in a chunk of their own.
 */
import {
	applyVioletThemePreset,
	installVioletTheme,
	loadVioletBuiltInTheme,
} from '@lushly-dev/violet-elements/theme-runtime';

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

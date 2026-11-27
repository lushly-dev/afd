/**
 * @fileoverview The console's chunk (phase 1 specification, 7.7 and 9.2): nothing here or in
 * `@lushly-dev/loam-console` loads until a console renders.
 */

import { defineConsole } from '@lushly-dev/loam-console';
import { nativeAppsSupported } from './support-floor.js';

let registry: CustomElementRegistry | null = null;

/**
 * One registry for every console in the page: it holds only the chrome's own elements. Below the support floor, in a
 * browser with no scoped registries (D174), it is the global one: the console is the chrome's, so a mounted app still
 * opens.
 */
export async function consoleRegistry(): Promise<CustomElementRegistry> {
	if (!nativeAppsSupported()) {
		await defineConsole();
		return customElements;
	}
	registry ??= new CustomElementRegistry();
	await defineConsole(registry);
	return registry;
}

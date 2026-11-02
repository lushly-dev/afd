/**
 * @fileoverview The console's chunk (phase 1 specification, 7.7 and 9.2): nothing here or in
 * `@lushly-dev/loam-console` loads until a console renders.
 */

import { defineConsole } from '@lushly-dev/loam-console';

let registry: CustomElementRegistry | null = null;

/** One registry for every console in the page: it holds only the chrome's own elements. */
export async function consoleRegistry(): Promise<CustomElementRegistry> {
	registry ??= new CustomElementRegistry();
	await defineConsole(registry);
	return registry;
}

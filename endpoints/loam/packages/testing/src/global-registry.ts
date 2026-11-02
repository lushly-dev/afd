/**
 * @fileoverview Watching the global element registry from the test kit's own import, since a definition
 * arrives already imported (phase 1 specification, 5.1 and 9.5).
 */

/** What the watch reads and sets on the global object. */
export interface RegistryScope {
	customElements?: CustomElementRegistry;
	HTMLElement?: unknown;
}

/** Record each global definition in `defined`: over a real registry in a DOM, or a stand-in under Node. */
export function watchGlobalRegistry(scope: RegistryScope, defined: string[]): void {
	// So a module defining an element reaches the kit's check, and not a bare ReferenceError.
	scope.HTMLElement ??= class {};
	if (scope.customElements) {
		const registry = scope.customElements;
		const define = registry.define.bind(registry);
		registry.define = (name, element, options) => {
			defined.push(name);
			define(name, element, options);
		};
		return;
	}
	const elements = new Map<string, CustomElementConstructor>();
	scope.customElements = {
		define(name: string, element: CustomElementConstructor) {
			defined.push(name);
			elements.set(name, element);
		},
		get: (name: string) => elements.get(name),
		getName: () => null,
		upgrade() {},
		whenDefined: () => new Promise<CustomElementConstructor>(() => {}),
	} as unknown as CustomElementRegistry;
}

import { describe, expect, it, vi } from 'vitest';
import { type RegistryScope, watchGlobalRegistry } from './global-registry.js';

describe('watchGlobalRegistry', () => {
	it('stands in under Node, and answers what a module may ask at its top level', () => {
		const scope: RegistryScope = {};
		const defined: string[] = [];
		watchGlobalRegistry(scope, defined);
		expect(scope.HTMLElement).toBeTypeOf('function');
		const registry = scope.customElements as CustomElementRegistry;
		class Element {}
		expect(registry.get('x-a')).toBeUndefined();
		registry.define('x-a', Element as unknown as CustomElementConstructor);
		expect(defined).toEqual(['x-a']);
		expect(registry.get('x-a')).toBe(Element);
		expect(registry.getName(Element as unknown as CustomElementConstructor)).toBeNull();
		expect(registry.upgrade(undefined as never)).toBeUndefined();
		expect(registry.whenDefined('x-a')).toBeInstanceOf(Promise);
	});

	it('wraps a real registry, which still defines the element', () => {
		const define = vi.fn();
		const real = { define } as unknown as CustomElementRegistry;
		const element = class {} as unknown as CustomElementConstructor;
		const scope: RegistryScope = { customElements: real, HTMLElement: Object };
		const defined: string[] = [];
		watchGlobalRegistry(scope, defined);
		real.define('x-b', element);
		expect(defined).toEqual(['x-b']);
		expect(define).toHaveBeenCalledWith('x-b', element, undefined);
		expect(scope.HTMLElement).toBe(Object);
	});
});

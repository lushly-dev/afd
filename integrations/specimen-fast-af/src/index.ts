import { getCommandMetadata } from '@lushly-dev/fast-element/command.js';
import { enableDefinitionSchema, getSchema } from '@lushly-dev/fast-element/definition-schema.js';
import type { SpecimenPlugin, ThemePreset, TokenMap } from '@lushly-dev/specimen';
import { type FastComponentSchema, mergeFastSchema } from './schema.js';

export { type FastComponentSchema, mergeFastSchema } from './schema.js';

/** A FAST-AF theme module's presets, as `@lushly-dev/violet-elements`' theme exports them. */
export interface FastAfThemes {
	presets: readonly string[];
	/** Apply a preset to a document or an element, as `applyVioletThemePreset` does. */
	apply(target: Document | HTMLElement, preset: string): unknown;
	/** Install the theme's stylesheet once, as `installVioletTheme` does. */
	install?(): unknown;
}
export interface FastAfOptions {
	themes?: FastAfThemes;
	/** FAST-AF's private alias registry, composed with the public token maps. */
	tokens?: TokenMap;
}

/**
 * The FAST-AF plugin. Creating it enables FAST's Definition Schema, so every FAST element
 * defined after the plugin installs records its schema; the bench installs plugins before
 * any specimen or story module loads.
 */
export function fastAf(options: FastAfOptions = {}): SpecimenPlugin {
	enableDefinitionSchema();
	const { themes } = options;
	let installed = false;
	const preset =
		(name: string): ThemePreset =>
		({ document }) => {
			if (!installed) {
				themes?.install?.();
				installed = true;
			}
			themes?.apply(document, name);
		};
	return {
		id: 'fast-af',
		schema(tag, base) {
			const fast = getSchema(tag) as FastComponentSchema | undefined;
			return fast ? mergeFastSchema(tag, base, fast) : base;
		},
		...(themes
			? { themes: Object.fromEntries(themes.presets.map((name) => [name, preset(name)])) }
			: {}),
		...(options.tokens ? { tokens: options.tokens } : {}),
		runners: {
			'fast-af': {
				commands: (element) => getCommandMetadata(element.constructor).map((command) => command.id),
				run(element, name, input) {
					const command = getCommandMetadata(element.constructor).find((item) => item.id === name);
					if (!command)
						throw new Error(
							`${element.localName} has no FAST-AF command '${name}'; it has ${
								getCommandMetadata(element.constructor)
									.map((item) => item.id)
									.join(', ') || 'none'
							}.`
						);
					const method = (element as unknown as Record<string, unknown>)[command.methodName];
					if (typeof method !== 'function')
						throw new Error(`${element.localName}.${command.methodName} is not a function.`);
					return input === undefined ? method.call(element) : method.call(element, input);
				},
			},
		},
	};
}

/**
 * Specimen's four plugin points. A plugin is a page module's default export (one plugin or an
 * array), bundled with the bench and installed before any specimen or story module loads, so
 * extensions that observe element definitions see every one.
 *
 * - Schema source: enrich what core reads from the custom elements manifest. Knowledge a
 *   source does not have stays unknown; it is never invented.
 * - Context provider: named themes a native specimen's `theme` context applies.
 * - Token map: public variable names to token ids, and private aliases to public variables,
 *   versioned and validated together.
 * - Command runner: a named runner for explicit command steps. Runner ids are unique across
 *   plugins; a step naming a missing runner fails before it runs.
 */

/** A value a property or attribute can take, when the source knows a finite set of them. */
export type SchemaValue = string | number | boolean | null;

export interface PropertySchema {
	name: string;
	/** The type as the source states it, such as `string`, `boolean` or `'a' | 'b'`. */
	type?: string;
	/** The attribute that reflects the property, when one does. */
	attribute?: string;
	/** A finite partition of values, when the source knows one. */
	values?: SchemaValue[];
	default?: string;
	description?: string;
}
export interface ComponentSchema {
	tag: string;
	/** The sources that contributed: `manifest`, then each plugin's id. */
	sources: string[];
	properties: PropertySchema[];
	/** Attributes without a property. */
	attributes: PropertySchema[];
	slots: { name: string; description?: string }[];
	events: { name: string; type?: string; description?: string }[];
	cssProperties: { name: string; default?: string; description?: string }[];
	commands: { id: string; label?: string; description?: string }[];
	/** What no source could say, such as `events` for a tag the manifest does not describe. */
	unknown: string[];
}

/** Attached to the page's document, and to the mount root a native specimen renders into. */
export interface ThemeTarget {
	document: Document;
	root: HTMLElement;
}
/** Applies one named theme; a returned function undoes it at disposal, any other value is ignored. */
export type ThemePreset = (target: ThemeTarget) => unknown;

export interface TokenMap {
	/** Who owns the map, for example `violet` for public names or `fast-af` for aliases. */
	id: string;
	version: string;
	/** Public CSS variable name, with its `--`, to token id. */
	tokens?: Record<string, string>;
	/** Private variable name to the public variable it aliases. */
	aliases?: Record<string, string>;
}

export interface CommandRunner {
	/** The commands this runner offers on an element, when it can list them. */
	commands?(element: Element): string[] | undefined;
	run(element: Element, name: string, input: unknown): unknown;
}

export interface SpecimenPlugin {
	id: string;
	/** Enrich a component's schema; `schema` is core's, or `undefined` when the manifest lacks the tag. */
	schema?(
		tag: string,
		schema: ComponentSchema | undefined
	): ComponentSchema | undefined | Promise<ComponentSchema | undefined>;
	themes?: Record<string, ThemePreset>;
	tokens?: TokenMap;
	runners?: Record<string, CommandRunner>;
}

/** Declare a plugin with its type checked. */
export function definePlugin(plugin: SpecimenPlugin): SpecimenPlugin {
	return plugin;
}

const VARIABLE = /^--[A-Za-z0-9_-]+$/;

export interface ComposedTokens {
	/** Public variable to its token id and the map that names it. */
	tokens: Record<string, { id: string; map: string }>;
	/** Private variable to the public variable it resolves to through any chain of aliases. */
	aliases: Record<string, { target: string; resolved: string | null; map: string }>;
	/** The maps composed, by owner and version. */
	versions: Record<string, string>;
	problems: string[];
}

/**
 * Compose token maps and validate them together: every map is versioned, owners are unique,
 * a public name has one token id, an alias chain ends at a public name, and no chain cycles.
 * An alias that resolves nowhere is kept with `resolved: null`, not dropped.
 */
export function composeTokenMaps(maps: readonly TokenMap[]): ComposedTokens {
	const composed: ComposedTokens = { tokens: {}, aliases: {}, versions: {}, problems: [] };
	for (const map of maps) {
		if (!map.id) composed.problems.push('A token map has no id.');
		if (!map.version) composed.problems.push(`Token map '${map.id}' has no version.`);
		if (Object.hasOwn(composed.versions, map.id))
			composed.problems.push(`Token map '${map.id}' is registered twice.`);
		composed.versions[map.id] = map.version;
		for (const [name, id] of Object.entries(map.tokens ?? {})) {
			if (!VARIABLE.test(name))
				composed.problems.push(`'${name}' in token map '${map.id}' is not a CSS variable name.`);
			const existing = composed.tokens[name];
			if (existing && existing.id !== id)
				composed.problems.push(
					`'${name}' is token '${existing.id}' in '${existing.map}' and '${id}' in '${map.id}'.`
				);
			else composed.tokens[name] = { id, map: map.id };
		}
		for (const [name, target] of Object.entries(map.aliases ?? {})) {
			if (!VARIABLE.test(name) || !VARIABLE.test(target))
				composed.problems.push(
					`Alias '${name}' → '${target}' in '${map.id}' is not between CSS variable names.`
				);
			if (Object.hasOwn(composed.aliases, name))
				composed.problems.push(
					`Alias '${name}' is declared in '${composed.aliases[name]?.map}' and '${map.id}'.`
				);
			composed.aliases[name] = { target, resolved: null, map: map.id };
		}
	}
	for (const [name, alias] of Object.entries(composed.aliases)) {
		const seen = new Set([name]);
		let current = alias.target;
		while (Object.hasOwn(composed.aliases, current) && !Object.hasOwn(composed.tokens, current)) {
			if (seen.has(current)) {
				composed.problems.push(`Alias '${name}' cycles through '${current}'.`);
				current = '';
				break;
			}
			seen.add(current);
			current = composed.aliases[current]?.target ?? '';
		}
		if (current && Object.hasOwn(composed.tokens, current)) alias.resolved = current;
		else if (current)
			composed.problems.push(`Alias '${name}' resolves to '${current}', which no map names.`);
	}
	return composed;
}

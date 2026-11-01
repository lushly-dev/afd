import type { ElementObservation } from './types.js';

/**
 * Generated-id canonicalization shared by DOM and element evidence. Names sort in a fixed
 * collation, so normalization does not depend on the process's or the page's default locale.
 */
const GENERATED_ID = /^specimen-generated-\d+$/;
const ID_REFERENCES = new Set([
	'for',
	'form',
	'list',
	'headers',
	'itemref',
	'popovertarget',
	'commandfor',
	'aria-activedescendant',
	'aria-controls',
	'aria-describedby',
	'aria-details',
	'aria-errormessage',
	'aria-flowto',
	'aria-labelledby',
	'aria-owns',
]);
const ID_STATE_FIELDS = new Set([
	'id',
	'activeDescendant',
	'ariaActiveDescendant',
	'activeElementId',
]);

export interface IdMap {
	definitions: Map<string, string>;
	missing: Map<string, string>;
	prefix: string;
}

export const compareNames = (a: string, b: string): number => a.localeCompare(b, 'en-US');

export function createIdMap(attributes: Record<string, string>[]): IdMap {
	const ids = attributes.flatMap((values) => (values.id === undefined ? [] : [values.id]));
	const reserved = new Set(
		attributes.flatMap((values) => Object.values(values).flatMap((v) => v.split(/\s+/)))
	);
	let prefix = '__specimen_normalized_';
	while ([...reserved].some((value) => value.startsWith(prefix))) prefix = `_${prefix}`;
	const definitions = new Map<string, string>();
	for (const id of ids) {
		if (GENERATED_ID.test(id) && !definitions.has(id)) {
			definitions.set(id, `${prefix}id_${definitions.size + 1}__`);
		}
	}
	return { definitions, missing: new Map(), prefix };
}

function reference(value: string, ids: IdMap): string {
	const known = ids.definitions.get(value);
	if (known !== undefined) return known;
	if (!GENERATED_ID.test(value)) return value;
	// Missing references receive a separate namespace: canonicalizing a real id
	// must never accidentally repair an originally broken relationship.
	let missing = ids.missing.get(value);
	if (missing === undefined) {
		missing = `${ids.prefix}missing_${ids.missing.size + 1}__`;
		ids.missing.set(value, missing);
	}
	return missing;
}

export function normalizeAttribute(name: string, value: string, ids: IdMap): string {
	if (name === 'id') return ids.definitions.get(value) ?? value;
	if (ID_REFERENCES.has(name)) return value.replace(/\S+/g, (token) => reference(token, ids));
	if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
		return `#${reference(value.slice(1), ids)}`;
	}
	return value;
}

function scopeOf(ref: string): string {
	const boundary = ref.lastIndexOf('/shadow/');
	return boundary < 0 ? 'root' : ref.slice(0, boundary + '/shadow/'.length);
}

/** Normalize identifier-valued evidence with the same per-root rules as DOM. */
export function normalizeElements(elements: ElementObservation[]): ElementObservation[] {
	const scopes = new Map<string, ElementObservation[]>();
	for (const item of elements) {
		const scope = scopeOf(item.ref);
		const siblings = scopes.get(scope) ?? [];
		siblings.push(item);
		scopes.set(scope, siblings);
	}
	const maps = new Map(
		[...scopes].map(([scope, items]) => [scope, createIdMap(items.map((item) => item.attributes))])
	);
	return elements.map((item) => {
		const ids = maps.get(scopeOf(item.ref));
		if (!ids) throw new Error(`Missing normalization scope for ${item.ref}`);
		return {
			...item,
			attributes: Object.fromEntries(
				Object.entries(item.attributes)
					.sort(([a], [b]) => compareNames(a, b))
					.map(([name, value]) => [name, normalizeAttribute(name, value, ids)])
			),
			state: Object.fromEntries(
				Object.entries(item.state)
					.sort(([a], [b]) => compareNames(a, b))
					.map(([name, value]) => [
						name,
						typeof value === 'string' && ID_STATE_FIELDS.has(name) ? reference(value, ids) : value,
					])
			),
		};
	});
}

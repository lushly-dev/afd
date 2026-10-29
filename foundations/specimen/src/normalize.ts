import { type DefaultTreeAdapterTypes, parseFragment, serializeOuter } from 'parse5';
import type { ElementObservation } from './types.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

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

interface IdMap {
	definitions: Map<string, string>;
	missing: Map<string, string>;
	prefix: string;
}

function element(node: Node): node is Element {
	return 'tagName' in node;
}

function children(node: Node): Node[] {
	return 'childNodes' in node ? node.childNodes : [];
}

function attributeName(attribute: Element['attrs'][number]): string {
	return `${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}`;
}

function createIdMap(attributes: Record<string, string>[]): IdMap {
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

function normalizeAttribute(name: string, value: string, ids: IdMap): string {
	if (name === 'id') return ids.definitions.get(value) ?? value;
	if (ID_REFERENCES.has(name)) return value.replace(/\S+/g, (token) => reference(token, ids));
	if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
		return `#${reference(value.slice(1), ids)}`;
	}
	return value;
}

function attrs(element: Element): Record<string, string> {
	return Object.fromEntries(
		element.attrs.map((attribute) => [attributeName(attribute), attribute.value])
	);
}

function normalizeScope(nodes: Node[]): void {
	const elements: Element[] = [];
	const nested: Node[][] = [];
	function collect(node: Node): void {
		if (element(node)) {
			elements.push(node);
			if ('content' in node)
				nested.push((node.content as DefaultTreeAdapterTypes.DocumentFragment).childNodes);
		}
		for (const child of children(node)) collect(child);
	}
	for (const node of nodes) collect(node);
	const ids = createIdMap(elements.map(attrs));
	for (const item of elements) {
		item.attrs.sort((a, b) => attributeName(a).localeCompare(attributeName(b)));
		for (const attribute of item.attrs) {
			attribute.value = normalizeAttribute(attributeName(attribute), attribute.value, ids);
		}
	}
	for (const scope of nested) normalizeScope(scope);
}

/**
 * Canonicalize attributes and explicitly recognized generated ids without
 * removing text, whitespace, comments, arbitrary ids or framework markers.
 * Template contents (including serialized shadow roots) have their own scope.
 */
export function normalizeDom(raw: string): string {
	const fragment = parseFragment(raw, { sourceCodeLocationInfo: true });
	normalizeScope(fragment.childNodes);
	return fragment.childNodes.map((node) => serializePreservingText(node, raw)).join('');
}

function serializePreservingText(node: Node, raw: string): string {
	if (!element(node)) {
		const location = 'sourceCodeLocation' in node ? node.sourceCodeLocation : undefined;
		return location ? raw.slice(location.startOffset, location.endOffset) : serializeOuter(node);
	}
	const contents =
		'content' in node
			? (node.content as DefaultTreeAdapterTypes.DocumentFragment).childNodes
			: node.childNodes;
	const empty = { ...node, childNodes: [] };
	if ('content' in empty) empty.content = { nodeName: '#document-fragment', childNodes: [] };
	const shell = serializeOuter(empty);
	const closing = shell.lastIndexOf(`</${node.tagName}>`);
	if (closing < 0) return shell;
	let prefix = '';
	if (['pre', 'textarea', 'listing'].includes(node.tagName)) {
		const start = node.sourceCodeLocation?.startTag?.endOffset;
		const first = contents[0];
		const end =
			first && 'sourceCodeLocation' in first
				? first.sourceCodeLocation?.startOffset
				: node.sourceCodeLocation?.endTag?.startOffset;
		if (start !== undefined && end !== undefined) {
			const omitted = raw.slice(start, end);
			if (/^(?:\r\n|\n|\r)$/.test(omitted)) prefix = omitted;
		}
	}
	return (
		shell.slice(0, closing) +
		prefix +
		contents.map((child) => serializePreservingText(child, raw)).join('') +
		shell.slice(closing)
	);
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
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([name, value]) => [name, normalizeAttribute(name, value, ids)])
			),
			state: Object.fromEntries(
				Object.entries(item.state)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([name, value]) => [
						name,
						typeof value === 'string' && ID_STATE_FIELDS.has(name) ? reference(value, ids) : value,
					])
			),
		};
	});
}

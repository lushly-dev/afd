/**
 * @fileoverview A skill's frontmatter (`spec/mcp-resources.md`, S2): a line `---`, one YAML
 * mapping, a line `---`.
 *
 * The YAML is read with the YAML 1.2 core schema, so `2026-11-01` unquoted is a string, `yes` is
 * a string and `0x10` is 16, and with no tags, anchors or aliases. Every value is a string, a
 * finite number, a boolean, null, a sequence or a mapping, and every key is a string. The tree is
 * walked here so those rules are ours and not the library's defaults.
 */

import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';

/** Nesting deeper than this is refused: the frontmatter is metadata. */
const MAX_DEPTH = 64;

/**
 * Parse the frontmatter at the start of `text` into a JSON object.
 *
 * @throws An error naming the rule the frontmatter breaks.
 */
export function parseFrontmatter(text: string): Record<string, unknown> {
	return readMapping(extract(text));
}

/** The YAML between the opening and the closing `---` line. */
function extract(text: string): string {
	const lines = text.split(/(?<=\n)/);
	const isFence = (line: string) => line.replace(/[\r\n]+$/, '') === '---';
	if (!lines[0] || !isFence(lines[0])) throw new Error('SKILL.md must begin with a line ---');
	const body: string[] = [];
	for (const line of lines.slice(1)) {
		if (isFence(line)) return body.join('');
		body.push(line);
	}
	throw new Error('the frontmatter has no closing line ---');
}

type Node = unknown;

function readMapping(yaml: string): Record<string, unknown> {
	let value: unknown;
	try {
		const document = parseDocument(yaml, {
			version: '1.2',
			schema: 'core',
			uniqueKeys: true,
			merge: false,
		});
		const [first] = document.errors;
		if (first) {
			throw new Error(
				first.code === 'DUPLICATE_KEY'
					? `the frontmatter repeats a key (${first.message.split('\n')[0]})`
					: first.code === 'MULTIPLE_DOCS'
						? 'the frontmatter must be one YAML document'
						: `the frontmatter is not valid YAML: ${first.message.split('\n')[0]}`
			);
		}
		value = read(document.contents, 1);
	} catch (error) {
		if (error instanceof RangeError) {
			throw new Error(`the frontmatter is nested more than ${MAX_DEPTH} levels`);
		}
		throw error;
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('the frontmatter must be one YAML mapping');
	}
	return value as Record<string, unknown>;
}

/** The JSON value of a parsed node, refusing everything the spec refuses. */
function read(node: Node, depth: number): unknown {
	if (node === null || node === undefined) return null;
	if (isAlias(node)) throw new Error('the frontmatter uses a YAML alias');
	const decorated = node as { anchor?: string; tag?: string };
	if (decorated.anchor) throw new Error('the frontmatter uses a YAML anchor');
	if (decorated.tag) throw new Error('the frontmatter uses a YAML tag');
	if (isScalar(node)) {
		const value = node.value;
		if (typeof value === 'number' && !Number.isFinite(value)) {
			throw new Error(`the frontmatter holds ${String(value)}, which is not a finite number`);
		}
		if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
		throw new Error('the frontmatter holds a value that is not a string, number, boolean or null');
	}
	if (depth > MAX_DEPTH) throw new Error(`the frontmatter is nested more than ${MAX_DEPTH} levels`);
	if (isSeq(node)) return node.items.map((item) => read(item, depth + 1));
	if (isMap(node)) {
		const entries: Record<string, unknown> = {};
		for (const pair of node.items) {
			if (!isPair(pair)) throw new Error('the frontmatter is not valid YAML');
			const key =
				isScalar(pair.key) && !pair.key.anchor && !pair.key.tag ? pair.key.value : undefined;
			if (typeof key !== 'string') throw new Error('a mapping key must be a string');
			if (Object.hasOwn(entries, key)) throw new Error(`the frontmatter repeats the key "${key}"`);
			// `defineProperty`, so a key such as `__proto__` stays an own property.
			Object.defineProperty(entries, key, {
				value: read(pair.value, depth + 1),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		return entries;
	}
	throw new Error('the frontmatter is not valid YAML');
}

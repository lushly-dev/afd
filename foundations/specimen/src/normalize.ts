import { compareNames, createIdMap, normalizeAttribute } from './normalize-ids.js';

export { normalizeElements } from './normalize-ids.js';

/** A start tag: its span in the source, and its attributes as written there. */
interface StartTag {
	name: string;
	start: number;
	end: number;
	selfClosing: boolean;
	attributes: [name: string, value: string][];
}

const TAG_NAME = /[^\t\n\f\r />]+/y;
const ATTRIBUTE =
	/[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/y;
const TAG_END = /[\t\n\f\r /]*>/y;
const LETTER = /[a-zA-Z]/;
/** Elements a parser reads as text, each with the end tag that stops it. */
const TEXT_ELEMENTS = new Map(
	['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].map(
		(name) => [name, new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi')]
	)
);

function startTag(raw: string, start: number): StartTag | undefined {
	TAG_NAME.lastIndex = start + 1;
	const name = TAG_NAME.exec(raw)?.[0] ?? '';
	let position = TAG_NAME.lastIndex;
	// As in HTML, the first of a repeated attribute wins.
	const attributes = new Map<string, string>();
	for (;;) {
		ATTRIBUTE.lastIndex = position;
		const match = ATTRIBUTE.exec(raw);
		if (!match?.[1]) break;
		position = ATTRIBUTE.lastIndex;
		if (!attributes.has(match[1])) attributes.set(match[1], match[2] ?? match[3] ?? match[4] ?? '');
	}
	TAG_END.lastIndex = position;
	if (!TAG_END.test(raw)) return undefined;
	const end = TAG_END.lastIndex;
	return {
		name,
		start,
		end,
		selfClosing: raw[end - 2] === '/',
		attributes: [...attributes],
	};
}

/** Where the text after `at` resumes, past the first `marker`, or the end when there is none. */
function after(raw: string, marker: string, at: number): number {
	const found = raw.indexOf(marker, at);
	return found < 0 ? raw.length : found + marker.length;
}

/**
 * Every start tag in the source, in order, and the scopes they fall in: a template's contents,
 * including a serialized shadow root's, are a scope of their own.
 */
function scan(raw: string): { tags: StartTag[]; scopes: StartTag[][] } {
	const tags: StartTag[] = [];
	const root: StartTag[] = [];
	const scopes = [root];
	const open = [root];
	let position = 0;
	while (position < raw.length) {
		const at = raw.indexOf('<', position);
		if (at < 0) break;
		const next = raw[at + 1] ?? '';
		if (raw.startsWith('<!--', at)) position = after(raw, '-->', at + 2);
		else if (next === '!' || next === '?') position = after(raw, '>', at + 2);
		else if (next === '/') {
			TAG_NAME.lastIndex = at + 2;
			const name = TAG_NAME.exec(raw)?.[0].toLowerCase();
			if (name === 'template' && open.length > 1) open.pop();
			position = after(raw, '>', at + 2);
		} else if (!LETTER.test(next)) position = at + 1;
		else {
			const tag = startTag(raw, at);
			// A tag the source never closes stays as it was written.
			if (!tag) break;
			tags.push(tag);
			open.at(-1)?.push(tag);
			position = tag.end;
			const name = tag.name.toLowerCase();
			if (name === 'plaintext') break;
			if (name === 'template') {
				const scope: StartTag[] = [];
				scopes.push(scope);
				open.push(scope);
			}
			const ends = TEXT_ELEMENTS.get(name);
			if (ends) {
				ends.lastIndex = position;
				position = ends.exec(raw)?.index ?? raw.length;
			}
		}
	}
	return { tags, scopes };
}

function normalizeScope(tags: StartTag[]): void {
	const ids = createIdMap(tags.map((tag) => Object.fromEntries(tag.attributes)));
	for (const tag of tags) {
		tag.attributes.sort(([a], [b]) => compareNames(a, b));
		for (const attribute of tag.attributes)
			attribute[1] = normalizeAttribute(attribute[0], attribute[1], ids);
	}
}

function written(tag: StartTag): string {
	const attributes = tag.attributes
		.map(([name, value]) => ` ${name}="${value.replaceAll('"', '&quot;')}"`)
		.join('');
	return `<${tag.name}${attributes}${tag.selfClosing ? '/' : ''}>`;
}

/**
 * Canonicalize attributes and explicitly recognized generated ids without
 * removing text, whitespace, comments, arbitrary ids or framework markers.
 * Template contents (including serialized shadow roots) have their own scope.
 *
 * A scan of the browser's own serialization, small enough for the bench page's shell. It builds
 * no tree, so what it returns has the structure the capture has: a table row with no `tbody` or
 * a block inside a paragraph, which a parser would repair, stays as the DOM had it.
 */
export function normalizeDom(raw: string): string {
	const { tags, scopes } = scan(raw);
	for (const scope of scopes) normalizeScope(scope);
	const parts: string[] = [];
	let position = 0;
	for (const tag of tags) {
		parts.push(raw.slice(position, tag.start), written(tag));
		position = tag.end;
	}
	parts.push(raw.slice(position));
	return parts.join('');
}

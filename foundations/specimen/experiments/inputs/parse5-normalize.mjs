/**
 * The DOM normalization Specimen used through T06 step 5, on parse5: the reference
 * `src/normalize.ts`'s scan is held to. It builds a tree, so it also repairs what a parser would.
 */
import { parseFragment, serializeOuter } from 'parse5';
import { compareNames, createIdMap, normalizeAttribute } from '../../src/normalize-ids.ts';

const element = (node) => 'tagName' in node;
const children = (node) => ('childNodes' in node ? node.childNodes : []);
const attributeName = (attribute) =>
	`${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}`;
const attrs = (node) =>
	Object.fromEntries(node.attrs.map((attribute) => [attributeName(attribute), attribute.value]));

function normalizeScope(nodes) {
	const elements = [];
	const nested = [];
	function collect(node) {
		if (element(node)) {
			elements.push(node);
			if ('content' in node) nested.push(node.content.childNodes);
		}
		for (const child of children(node)) collect(child);
	}
	for (const node of nodes) collect(node);
	const ids = createIdMap(elements.map(attrs));
	for (const item of elements) {
		item.attrs.sort((a, b) => compareNames(attributeName(a), attributeName(b)));
		for (const attribute of item.attrs)
			attribute.value = normalizeAttribute(attributeName(attribute), attribute.value, ids);
	}
	for (const scope of nested) normalizeScope(scope);
}

function serializePreservingText(node, raw) {
	if (!element(node)) {
		const location = 'sourceCodeLocation' in node ? node.sourceCodeLocation : undefined;
		return location ? raw.slice(location.startOffset, location.endOffset) : serializeOuter(node);
	}
	const contents = 'content' in node ? node.content.childNodes : node.childNodes;
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

export function parse5Normalize(raw) {
	const fragment = parseFragment(raw, { sourceCodeLocationInfo: true });
	normalizeScope(fragment.childNodes);
	return fragment.childNodes.map((node) => serializePreservingText(node, raw)).join('');
}

import { type DefaultTreeAdapterTypes, parseFragment, serializeOuter } from 'parse5';
import { compareNames, createIdMap, normalizeAttribute } from './normalize-ids.js';

export { normalizeElements } from './normalize-ids.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

function element(node: Node): node is Element {
	return 'tagName' in node;
}

function children(node: Node): Node[] {
	return 'childNodes' in node ? node.childNodes : [];
}

function attributeName(attribute: Element['attrs'][number]): string {
	return `${attribute.prefix ? `${attribute.prefix}:` : ''}${attribute.name}`;
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
		item.attrs.sort((a, b) => compareNames(attributeName(a), attributeName(b)));
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

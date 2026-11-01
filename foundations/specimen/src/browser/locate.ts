/**
 * Selector targets: CSS whose descendant and child combinators cross open shadow boundaries, as
 * Playwright's CSS engine does. `violet-alert button` matches a button in the alert's shadow
 * tree, or in a shadow tree nested inside it. Each compound is checked with the browser's own
 * `Element.matches`; sibling combinators stay within one tree.
 */
type Combinator = ' ' | '>' | '+' | '~';
interface Part {
	compound: string;
	/** The combinator joining this compound to the previous one. */
	combinator: Combinator;
}

function parse(selector: string): Part[][] {
	const list: Part[][] = [];
	let parts: Part[] = [];
	let compound = '';
	let pending: Combinator | undefined;
	let depth = 0;
	let quote = '';
	const flush = () => {
		if (!compound) return;
		parts.push({ compound, combinator: parts.length ? (pending ?? ' ') : ' ' });
		compound = '';
		pending = undefined;
	};
	for (let index = 0; index < selector.length; index++) {
		const character = selector[index] ?? '';
		if (character === '\\') {
			compound += character + (selector[index + 1] ?? '');
			index++;
			continue;
		}
		if (quote) {
			compound += character;
			if (character === quote) quote = '';
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			compound += character;
			continue;
		}
		if (character === '(' || character === '[') depth++;
		if (character === ')' || character === ']') depth--;
		if (depth > 0) {
			compound += character;
			continue;
		}
		if (character === ',') {
			flush();
			if (!parts.length || (pending && pending !== ' '))
				throw new SyntaxError(`Invalid selector: ${selector}`);
			list.push(parts);
			parts = [];
			pending = undefined;
			continue;
		}
		if (/\s/.test(character) || character === '>' || character === '+' || character === '~') {
			flush();
			if (character === '>' || character === '+' || character === '~') {
				if ((pending && pending !== ' ') || !parts.length)
					throw new SyntaxError(`Invalid selector: ${selector}`);
				pending = character;
			} else if (parts.length && !pending) pending = ' ';
			continue;
		}
		compound += character;
	}
	flush();
	if (!parts.length || (pending && pending !== ' ') || depth || quote)
		throw new SyntaxError(`Invalid selector: ${selector}`);
	list.push(parts);
	return list;
}

function parentOrHost(element: Element): Element | null {
	if (element.parentElement) return element.parentElement;
	const root = element.parentNode;
	return root instanceof ShadowRoot ? root.host : null;
}

function matches(element: Element, parts: Part[], index: number): boolean {
	const part = parts[index];
	if (!part || !element.matches(part.compound)) return false;
	if (index === 0) return true;
	if (part.combinator === '>') {
		const parent = parentOrHost(element);
		return parent !== null && matches(parent, parts, index - 1);
	}
	if (part.combinator === '+') {
		const sibling = element.previousElementSibling;
		return sibling !== null && matches(sibling, parts, index - 1);
	}
	if (part.combinator === '~') {
		for (
			let sibling = element.previousElementSibling;
			sibling;
			sibling = sibling.previousElementSibling
		)
			if (matches(sibling, parts, index - 1)) return true;
		return false;
	}
	for (let ancestor = parentOrHost(element); ancestor; ancestor = parentOrHost(ancestor))
		if (matches(ancestor, parts, index - 1)) return true;
	return false;
}

/** Every element under `root`, in open shadow trees too, matching `selector`, in tree order. */
export function locate(root: Element, selector: string): Element[] {
	const list = parse(selector.trim());
	const found: Element[] = [];
	const visit = (scope: Element | ShadowRoot) => {
		for (const element of Array.from(scope.children)) {
			if (list.some((parts) => matches(element, parts, parts.length - 1))) found.push(element);
			if (element.shadowRoot) visit(element.shadowRoot);
			visit(element);
		}
	};
	visit(root);
	return found;
}

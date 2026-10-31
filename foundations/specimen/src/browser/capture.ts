import type { BrowserObservation, ElementObservation, SpecimenContext } from '../types.js';

const properties = [
	'display',
	'visibility',
	'position',
	'top',
	'right',
	'bottom',
	'left',
	'z-index',
	'box-sizing',
	'width',
	'height',
	'min-width',
	'max-width',
	'min-height',
	'max-height',
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'overflow',
	'overflow-x',
	'overflow-y',
	'clip-path',
	'white-space',
	'text-overflow',
	'font-family',
	'font-size',
	'font-weight',
	'font-style',
	'line-height',
	'letter-spacing',
	'text-align',
	'text-decoration',
	'color',
	'background-color',
	'background-image',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'border-top-color',
	'border-top-style',
	'border-radius',
	'outline',
	'outline-width',
	'outline-color',
	'outline-style',
	'box-shadow',
	'transform',
	'opacity',
	'gap',
	'row-gap',
	'column-gap',
	'align-items',
	'justify-content',
	'flex-direction',
	'flex-wrap',
	'grid-template-columns',
	'grid-template-rows',
] as const;

export function openElements(root: Element): Element[] {
	const elements: Element[] = [];
	function visit(element: Element): void {
		elements.push(element);
		if (element.shadowRoot) {
			for (const child of element.shadowRoot.children) visit(child);
		}
		for (const child of element.children) visit(child);
	}
	visit(root);
	return elements;
}

function focusedElement(): Element | null {
	let focused = document.activeElement;
	while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
	return focused;
}

function stateOf(element: Element, focused: Element | null): ElementObservation['state'] {
	const state: ElementObservation['state'] = { focused: element === focused };
	if (element instanceof HTMLInputElement) {
		state.value = element.value;
		state.checked = element.checked;
		state.indeterminate = element.indeterminate;
		state.disabled = element.disabled;
		state.readOnly = element.readOnly;
		state.valid = element.validity.valid;
	} else if (element instanceof HTMLTextAreaElement) {
		state.value = element.value;
		state.disabled = element.disabled;
		state.readOnly = element.readOnly;
		state.valid = element.validity.valid;
	} else if (element instanceof HTMLSelectElement) {
		state.value = element.value;
		state.selectedIndex = element.selectedIndex;
		state.disabled = element.disabled;
		state.valid = element.validity.valid;
	} else if (element instanceof HTMLOptionElement) {
		state.value = element.value;
		state.selected = element.selected;
		state.disabled = element.disabled;
	} else if (element instanceof HTMLButtonElement) {
		state.value = element.value;
		state.disabled = element.disabled;
	} else if (element instanceof HTMLDetailsElement || element instanceof HTMLDialogElement) {
		state.open = element.open;
	}
	return state;
}

function escapeText(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const voidTags = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/** Serialize open roots on browsers without Element.getHTML. Text is never collapsed. */
function serializeNode(node: Node): string {
	if (node instanceof Text) return escapeText(node.data);
	if (node instanceof Comment) return `<!--${node.data}-->`;
	if (!(node instanceof Element)) return '';
	const attrs = Array.from(
		node.attributes,
		(attribute) => ` ${attribute.name}="${escapeText(attribute.value).replaceAll('"', '&quot;')}"`
	).join('');
	const start = `<${node.localName}${attrs}>`;
	if (voidTags.has(node.localName)) return start;
	const shadow = node.shadowRoot
		? `<template shadowrootmode="open">${Array.from(node.shadowRoot.childNodes, serializeNode).join('')}</template>`
		: '';
	const children = node instanceof HTMLTemplateElement ? node.content.childNodes : node.childNodes;
	const content = ['style', 'script'].includes(node.localName)
		? (node.textContent ?? '')
		: Array.from(children, serializeNode).join('');
	return `${start}${shadow}${content}</${node.localName}>`;
}

function serialize(root: Element, elements: Element[]): string {
	if (typeof root.getHTML === 'function') {
		return root.getHTML({
			shadowRoots: elements.flatMap((element) => (element.shadowRoot ? [element.shadowRoot] : [])),
		});
	}
	return Array.from(root.childNodes, serializeNode).join('');
}

export function captureDocument(
	root: HTMLElement,
	closedHosts: WeakSet<Element>
): BrowserObservation {
	const elements = openElements(root);
	const refs = new Map<Element, string>([[root, 'root']]);
	const limitations: string[] = [];
	const focused = focusedElement();
	for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
		if (ancestor.getAnimations().some((animation) => animation.playState === 'running')) {
			limitations.push(
				`A running ancestor animation makes this a time-dependent sample at document/${ancestor.localName}.`
			);
		}
	}
	function visitChildren(parent: Element | ShadowRoot, prefix: string): void {
		const counts = new Map<string, number>();
		for (const child of parent.children) {
			const count = (counts.get(child.localName) ?? 0) + 1;
			counts.set(child.localName, count);
			const ref = `${prefix}/${child.localName}:${count}`;
			refs.set(child, ref);
			if (child.shadowRoot) visitChildren(child.shadowRoot, `${ref}/shadow`);
			visitChildren(child, ref);
		}
	}
	if (root.shadowRoot) visitChildren(root.shadowRoot, 'root/shadow');
	visitChildren(root, 'root');

	const observations = elements.map((element): ElementObservation => {
		const ref = refs.get(element) ?? 'unresolved';
		const computed = getComputedStyle(element);
		const styles: Record<string, string> = {};
		for (const property of properties) styles[property] = computed.getPropertyValue(property);
		for (const pseudo of ['::before', '::after']) {
			const pseudoStyle = getComputedStyle(element, pseudo);
			const content = pseudoStyle.getPropertyValue('content');
			if (content !== 'none' && content !== 'normal') {
				styles[`${pseudo}.content`] = content;
				for (const property of properties)
					styles[`${pseudo}.${property}`] = pseudoStyle.getPropertyValue(property);
				limitations.push(`Pseudo-element geometry is not observed at ${ref}${pseudo}.`);
			}
		}
		if (closedHosts.has(element)) limitations.push(`Closed shadow content is excluded at ${ref}.`);
		if (['canvas', 'img', 'video', 'iframe'].includes(element.localName)) {
			limitations.push(
				`Rendered ${element.localName} content is not represented by structured observations at ${ref}.`
			);
		}
		if (element.getAnimations().some((animation) => animation.playState === 'running')) {
			limitations.push(`A running animation makes this a time-dependent sample at ${ref}.`);
		}
		const box = element.getBoundingClientRect();
		return {
			ref,
			tag: element.localName,
			attributes: Object.fromEntries(
				Array.from(element.attributes, (attribute) => [attribute.name, attribute.value])
			),
			box: { x: box.x, y: box.y, width: box.width, height: box.height },
			scroll: {
				width: element.scrollWidth,
				height: element.scrollHeight,
				clientWidth: element.clientWidth,
				clientHeight: element.clientHeight,
			},
			styles,
			state: stateOf(element, focused),
		};
	});
	return {
		dom: serialize(root, elements),
		elements: observations,
		limitations: [...new Set(limitations)],
		viewport: {
			width: innerWidth,
			height: innerHeight,
			media: matchMedia('(max-width: 600px)').matches,
			colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
			reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'reduce'
				: 'no-preference',
			language: navigator.language,
			devicePixelRatio,
		},
	};
}

/** Compare language tags as the browser does, so `EN-us` and `en-US` are one locale. */
export function sameLocale(left: string, right: string): boolean {
	try {
		return Intl.getCanonicalLocales(left)[0] === Intl.getCanonicalLocales(right)[0];
	} catch {
		return left === right;
	}
}

/**
 * A driver that cannot emulate part of the requested context must say so: a document's
 * attributes alone do not change what its media queries and navigator report.
 */
export function contextMismatches(
	context: SpecimenContext,
	observed: BrowserObservation['viewport']
): string[] {
	const reasons: string[] = [];
	const { width, height } = context.viewport;
	if (observed.width !== width || observed.height !== height)
		reasons.push(
			`Context mismatch: the viewport is ${observed.width}x${observed.height}, not the requested ${width}x${height}.`
		);
	if (observed.colorScheme !== context.theme)
		reasons.push(
			`Context mismatch: prefers-color-scheme is ${observed.colorScheme}, not the requested ${context.theme}; only the theme attribute and color-scheme apply.`
		);
	if (observed.reducedMotion !== context.reducedMotion)
		reasons.push(
			`Context mismatch: prefers-reduced-motion is ${observed.reducedMotion}, not the requested ${context.reducedMotion}.`
		);
	if (!sameLocale(observed.language, context.locale))
		reasons.push(
			`Context mismatch: navigator.language is ${observed.language}, not the requested ${context.locale}; only the lang attribute applies.`
		);
	return reasons;
}

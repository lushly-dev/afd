import { type ClimbNode, type ClimbOptions, climbSelection, IGNORED_ROLES } from '../climb.js';

const NAME_FROM_CONTENT_ROLES = /* @__PURE__ */ new Set([
	'button',
	'cell',
	'checkbox',
	'columnheader',
	'gridcell',
	'heading',
	'link',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'radio',
	'rowheader',
	'switch',
	'tab',
	'tooltip',
	'treeitem',
]);

const TAG_ROLES: Record<string, string> = {
	article: 'article',
	aside: 'complementary',
	blockquote: 'blockquote',
	button: 'button',
	caption: 'caption',
	code: 'code',
	dd: 'definition',
	details: 'group',
	dialog: 'dialog',
	dl: 'list',
	dt: 'term',
	fieldset: 'group',
	figure: 'figure',
	h1: 'heading',
	h2: 'heading',
	h3: 'heading',
	h4: 'heading',
	h5: 'heading',
	h6: 'heading',
	hr: 'separator',
	li: 'listitem',
	main: 'main',
	menu: 'list',
	meter: 'meter',
	nav: 'navigation',
	ol: 'list',
	optgroup: 'group',
	option: 'option',
	output: 'status',
	p: 'paragraph',
	progress: 'progressbar',
	search: 'search',
	summary: 'button',
	table: 'table',
	tbody: 'rowgroup',
	td: 'cell',
	textarea: 'textbox',
	tfoot: 'rowgroup',
	thead: 'rowgroup',
	tr: 'row',
	ul: 'list',
};

const INPUT_ROLES: Record<string, string> = {
	button: 'button',
	checkbox: 'checkbox',
	image: 'button',
	number: 'spinbutton',
	radio: 'radio',
	range: 'slider',
	reset: 'button',
	submit: 'button',
};

/** Cross-realm check for an Element node (works on nodes inside an iframe's document). */
export function isElementNode(node: unknown): node is Element {
	return node !== null && typeof node === 'object' && (node as Node).nodeType === 1;
}

/** Cross-realm check for a ShadowRoot node (works on shadow roots inside an iframe). */
function isShadowRootNode(node: unknown): node is ShadowRoot {
	return (
		node !== null &&
		typeof node === 'object' &&
		(node as Node).nodeType === 11 &&
		'host' in node &&
		isElementNode((node as ShadowRoot).host)
	);
}

/** Parent element, crossing an open shadow root boundary to its host. */
export function parentOrHost(element: Element): Element | null {
	if (element.parentElement) return element.parentElement;
	const parent = element.parentNode;
	return isShadowRootNode(parent) ? parent.host : null;
}

/** Whether `element` is strictly inside `ancestor`, crossing open shadow roots. */
export function isDescendantOf(element: Element, ancestor: Element): boolean {
	for (let cur = parentOrHost(element); cur; cur = parentOrHost(cur)) {
		if (cur === ancestor) return true;
	}
	return false;
}

/** Compute Specimen's positional element reference relative to `root` (matching `capture.ts`). */
export function elementRef(element: Element, root: Element): string | null {
	if (element === root) return 'root';
	const segments: string[] = [];
	let current: Element = element;
	while (current !== root) {
		const parent = current.parentNode;
		if (!parent) return null;
		let index = 0;
		for (const sibling of parent.children) {
			if (sibling.localName === current.localName) index++;
			if (sibling === current) break;
		}
		segments.push(`${current.localName}:${index}`);
		if (isShadowRootNode(parent)) {
			segments.push('shadow');
			current = parent.host;
		} else if (isElementNode(parent)) {
			current = parent;
		} else {
			return null;
		}
	}
	segments.push('root');
	return segments.reverse().join('/');
}

/** Resolve a positional `root/.../tag:n` reference back to its live DOM element under `root`. */
export function resolveElementRef(root: Element, ref: string): Element | null {
	if (ref === 'root') return root;
	if (!ref.startsWith('root/')) return null;
	const parts = ref.split('/').slice(1);
	let scope: Element | ShadowRoot = root;
	for (const part of parts) {
		if (part === 'shadow') {
			if (!isElementNode(scope) || !scope.shadowRoot) return null;
			scope = scope.shadowRoot;
			continue;
		}
		const colon = part.lastIndexOf(':');
		if (colon <= 0) return null;
		const tag = part.slice(0, colon);
		const wanted = Number(part.slice(colon + 1));
		if (!Number.isSafeInteger(wanted) || wanted < 1) return null;
		let count = 0;
		let match: Element | null = null;
		for (const child of scope.children) {
			if (child.localName === tag) {
				count++;
				if (count === wanted) {
					match = child;
					break;
				}
			}
		}
		if (!match) return null;
		scope = match;
	}
	return isElementNode(scope) ? scope : null;
}

function normalizeSpace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function isElementHidden(element: Element): boolean {
	if (
		element.getAttribute('aria-hidden') === 'true' ||
		element.hasAttribute('hidden') ||
		element.hasAttribute('inert')
	) {
		return true;
	}
	const view = element.ownerDocument?.defaultView;
	if (!view) return false;
	const style = view.getComputedStyle(element);
	return style.display === 'none' || style.visibility === 'hidden';
}

function textFromNode(node: Node, includeShadow = false, allowHidden = false): string {
	if (node.nodeType === 3) return node.textContent ?? '';
	if (!isElementNode(node)) return '';
	if (!allowHidden && isElementHidden(node)) return '';
	if (node.localName === 'style' || node.localName === 'script') return '';
	if (node.localName === 'slot') {
		const assigned = (node as HTMLSlotElement).assignedNodes({ flatten: true });
		return assigned.map((child) => textFromNode(child, includeShadow, allowHidden)).join(' ');
	}
	if (node.localName === 'img') return node.getAttribute('alt') ?? '';
	const parts: string[] = [];
	if (includeShadow && node.shadowRoot) {
		for (const child of node.shadowRoot.childNodes)
			parts.push(textFromNode(child, includeShadow, allowHidden));
	} else {
		for (const child of node.childNodes)
			parts.push(textFromNode(child, includeShadow, allowHidden));
	}
	return parts.join(' ');
}

function explicitRole(element: Element): string | undefined {
	const raw = element.getAttribute('role')?.trim().toLowerCase();
	if (!raw) return undefined;
	return raw.split(/\s+/)[0];
}

function labelledByText(element: Element): string {
	const ids = element.getAttribute('aria-labelledby')?.trim();
	if (!ids) return '';
	const root = element.getRootNode();
	if (!('getElementById' in root)) return '';
	return normalizeSpace(
		ids
			.split(/\s+/)
			.map((id) => {
				const target = (root as Document | ShadowRoot).getElementById(id);
				return target ? textFromNode(target, true, true) : '';
			})
			.join(' ')
	);
}

/** Infer an element's semantic ARIA role in live DOM (matching Chromium's AXTree conventions). */
export function domRoleOf(element: Element): string | undefined {
	const explicit = explicitRole(element);
	if (explicit) return IGNORED_ROLES.has(explicit) ? undefined : explicit;

	const tag = element.localName;
	if (Object.hasOwn(TAG_ROLES, tag)) return TAG_ROLES[tag];
	if ((tag === 'a' || tag === 'area') && element.hasAttribute('href')) return 'link';
	if (tag === 'input') {
		const type = (element.getAttribute('type') ?? 'text').toLowerCase();
		if (type === 'hidden') return undefined;
		if (Object.hasOwn(INPUT_ROLES, type)) return INPUT_ROLES[type];
		if (element.hasAttribute('list')) return 'combobox';
		return type === 'search' ? 'searchbox' : 'textbox';
	}
	if (tag === 'select') {
		const size = Number(element.getAttribute('size') ?? '0');
		return element.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
	}
	if (tag === 'th') return element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
	if (tag === 'img') return element.getAttribute('alt') === '' ? undefined : 'img';
	if (tag === 'form' || tag === 'section') {
		const named = Boolean(element.getAttribute('aria-label')?.trim() || labelledByText(element));
		return named ? (tag === 'form' ? 'form' : 'region') : undefined;
	}
	return undefined;
}

/** Infer an element's accessible name in live DOM (without CDP). */
export function domAccessibleNameOf(
	element: Element,
	role = domRoleOf(element)
): string | undefined {
	const fromLabelledBy = labelledByText(element);
	if (fromLabelledBy) return fromLabelledBy;
	const ariaLabel = normalizeSpace(element.getAttribute('aria-label') ?? '');
	if (ariaLabel) return ariaLabel;

	const labels = (element as { labels?: NodeListOf<HTMLLabelElement> | null }).labels;
	if (labels && labels.length > 0) {
		const joined = normalizeSpace(
			Array.from(labels, (label) => textFromNode(label, false)).join(' ')
		);
		if (joined) return joined;
	}

	const tag = element.localName;
	if (tag === 'img' || tag === 'area') {
		const alt = normalizeSpace(element.getAttribute('alt') ?? '');
		if (alt) return alt;
	}
	if (tag === 'input') {
		const type = (element.getAttribute('type') ?? 'text').toLowerCase();
		if (type === 'image') {
			const alt = normalizeSpace(element.getAttribute('alt') ?? '');
			if (alt) return alt;
		}
		if (type === 'button' || type === 'submit' || type === 'reset') {
			const val = normalizeSpace(element.getAttribute('value') ?? '');
			if (val) return val;
		}
	}
	if (tag === 'fieldset') {
		const legend = Array.from(element.children).find((c) => c.localName === 'legend');
		const text = legend ? normalizeSpace(textFromNode(legend, false)) : '';
		if (text) return text;
	}
	if (tag === 'table') {
		const caption = Array.from(element.children).find((c) => c.localName === 'caption');
		const text = caption ? normalizeSpace(textFromNode(caption, false)) : '';
		if (text) return text;
	}
	if (tag === 'svg') {
		const title = Array.from(element.children).find((c) => c.localName === 'title');
		const text = title ? normalizeSpace(textFromNode(title, false)) : '';
		if (text) return text;
	}
	if (role && NAME_FROM_CONTENT_ROLES.has(role)) {
		const text = normalizeSpace(textFromNode(element, false));
		if (text) return text;
	}
	if (role) {
		const title = normalizeSpace(element.getAttribute('title') ?? '');
		if (title) return title;
	}
	return undefined;
}

/** Wrap a live DOM `Element` under `root` as a `ClimbNode<Element>`. */
export function domClimbNode(element: Element, root: Element): ClimbNode<Element> {
	const cache = new Map<Element, ClimbNode<Element>>();
	const wrap = (el: Element): ClimbNode<Element> => {
		const existing = cache.get(el);
		if (existing) return existing;
		const explicit = explicitRole(el);
		const presentational =
			explicit === 'none' ||
			explicit === 'presentation' ||
			(el.localName === 'img' && el.getAttribute('alt') === '');
		const role = domRoleOf(el);
		const name = domAccessibleNameOf(el, role);
		const node: ClimbNode<Element> = {
			value: el,
			tag: el.localName,
			...(role ? { role } : {}),
			...(name ? { name } : {}),
			ariaHidden: isElementHidden(el),
			presentational,
			parent() {
				const p = parentOrHost(el);
				return !p || p === root ? null : wrap(p);
			},
			shadowHost() {
				const r = el.getRootNode();
				if (isShadowRootNode(r) && r.host !== root) return wrap(r.host);
				return null;
			},
			shadowChildren() {
				return el.shadowRoot ? Array.from(el.shadowRoot.children, wrap) : [];
			},
			children() {
				return Array.from(el.children, wrap);
			},
			composedParent() {
				const slot = (el as { assignedSlot?: HTMLSlotElement | null }).assignedSlot;
				if (slot) return slot === root ? null : wrap(slot);
				const p = parentOrHost(el);
				return !p || p === root ? null : wrap(p);
			},
		};
		cache.set(el, node);
		return node;
	};
	return wrap(element);
}

/** Run the shared two-step climb on a live DOM element under `root`. */
export function climbElement(
	hit: Element,
	root: Element,
	options: ClimbOptions = {}
): { element: Element; accessible?: { role?: string; name?: string; from: Element } } {
	const result = climbSelection(domClimbNode(hit, root), options);
	return {
		element: result.selected.value,
		...(result.accessible
			? {
					accessible: {
						...(result.accessible.role ? { role: result.accessible.role } : {}),
						...(result.accessible.name ? { name: result.accessible.name } : {}),
						from: result.accessible.from.value,
					},
				}
			: {}),
	};
}

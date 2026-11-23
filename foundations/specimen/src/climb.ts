import type { ElementObservation } from './types.js';

/**
 * Leaf/widget interactive ARIA roles whose descendants (such as decorative icons or inner spans)
 * belong to the control rather than standing as separate meaningful targets.
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = /* @__PURE__ */ new Set([
	'button',
	'checkbox',
	'combobox',
	'link',
	'menuitem',
	'menuitemcheckbox',
	'menuitemradio',
	'option',
	'radio',
	'searchbox',
	'slider',
	'spinbutton',
	'switch',
	'tab',
	'textbox',
	'treeitem',
]);

export const IGNORED_ROLES: ReadonlySet<string> = /* @__PURE__ */ new Set([
	'generic',
	'none',
	'presentation',
]);

/** Tree node view shared by the static review page (live DOM) and `specimen-point` (captures). */
export interface ClimbNode<T = unknown> {
	readonly value: T;
	readonly tag: string;
	readonly role?: string;
	readonly name?: string;
	readonly ariaHidden?: boolean;
	readonly presentational?: boolean;
	parent(): ClimbNode<T> | null;
	/** Shadow host when this node lives inside an open shadow root; `null` in light DOM. */
	shadowHost(): ClimbNode<T> | null;
	shadowChildren(): readonly ClimbNode<T>[];
	children(): readonly ClimbNode<T>[];
	/** Optional composed parent (follows `assignedSlot` in live DOM) for interactive-ancestor checks. */
	composedParent?(): ClimbNode<T> | null;
}

export interface ClimbOptions {
	depth?: 'deepest';
}

export interface ClimbResult<T = unknown> {
	selected: ClimbNode<T>;
	accessible?: { role?: string; name?: string; from: ClimbNode<T> };
}

function isCustomTag(tag: string): boolean {
	return tag.includes('-');
}

function composedOrParent<T>(node: ClimbNode<T>): ClimbNode<T> | null {
	return node.composedParent ? node.composedParent() : node.parent();
}

function isInsideInteractiveRole<T>(node: ClimbNode<T>): boolean {
	for (let cur = composedOrParent(node); cur; cur = composedOrParent(cur)) {
		if (cur.role && INTERACTIVE_ROLES.has(cur.role)) return true;
	}
	return false;
}

function hasHiddenAncestor<T>(node: ClimbNode<T>): boolean {
	for (let cur: ClimbNode<T> | null = node; cur; cur = composedOrParent(cur)) {
		if (cur.ariaHidden) return true;
	}
	return false;
}

/**
 * Whether `node` is meaningful under Proposal §4.1:
 * has a semantic role, an accessible name, or a custom element tag — excluding decorative or
 * `aria-hidden="true"` elements (such as icons) inside an interactive role.
 */
export function isMeaningfulNode<T>(node: ClimbNode<T>): boolean {
	if (node.ariaHidden || node.presentational) return false;
	if (hasHiddenAncestor(node)) return false;
	const hasRole = Boolean(node.role && !IGNORED_ROLES.has(node.role));
	const hasName = Boolean(node.name);
	if (isInsideInteractiveRole(node)) {
		// Inside a leaf interactive control, a custom element with no role and no name (such as a
		// decorative `<violet-icon>`) belongs to the control, not as its own target.
		return hasRole || hasName;
	}
	return hasRole || hasName || isCustomTag(node.tag);
}

/** Whether `host`'s shadow root contains any meaningful element outside `excluded`'s subtree. */
function hasOtherMeaningfulInShadow<T>(host: ClimbNode<T>, excluded: ClimbNode<T>): boolean {
	const visit = (nodes: readonly ClimbNode<T>[]): boolean => {
		for (const node of nodes) {
			if (node.value === excluded.value) continue;
			if (isMeaningfulNode(node)) return true;
			if (visit(node.children())) return true;
		}
		return false;
	};
	return visit(host.shadowChildren());
}

/** First descendant inside a custom element's shadow root that carries a role or accessible name. */
function soleAccessibleInShadow<T>(host: ClimbNode<T>): ClimbNode<T> | undefined {
	let found: ClimbNode<T> | undefined;
	const visit = (nodes: readonly ClimbNode<T>[]): boolean => {
		for (const node of nodes) {
			if (node.ariaHidden) continue;
			if (!node.presentational) {
				const hasRole = Boolean(node.role && !IGNORED_ROLES.has(node.role));
				const hasName = Boolean(node.name);
				if (hasRole || hasName) {
					if (found) return false;
					found = node;
					continue;
				}
			}
			if (isCustomTag(node.tag) && !visit(node.shadowChildren())) return false;
			if (!visit(node.children())) return false;
		}
		return true;
	};
	return visit(host.shadowChildren()) ? found : undefined;
}

function accessibleOf<T>(
	node: ClimbNode<T> | undefined
): { role?: string; name?: string; from: ClimbNode<T> } | undefined {
	if (!node) return undefined;
	const role = node.role && !IGNORED_ROLES.has(node.role) ? node.role : undefined;
	const name = node.name || undefined;
	if (!role && !name) return undefined;
	return { ...(role ? { role } : {}), ...(name ? { name } : {}), from: node };
}

/**
 * The accessibility node for an already-selected element: the element's own role/name when it has
 * one, or the sole accessible descendant inside its shadow root when it is a custom element.
 */
export function nodeAccessible<T>(
	node: ClimbNode<T>
): { role?: string; name?: string; from: ClimbNode<T> } | undefined {
	return (
		accessibleOf(node) ??
		(isCustomTag(node.tag) ? accessibleOf(soleAccessibleInShadow(node)) : undefined)
	);
}

/**
 * Shared two-step meaningful-element climb (Proposal §4.1).
 * Both the static review page and `specimen-point` call this function so a click and a named
 * target select the exact same element.
 */
export function climbSelection<T>(hit: ClimbNode<T>, options: ClimbOptions = {}): ClimbResult<T> {
	if (options.depth === 'deepest') {
		const accessible = accessibleOf(hit);
		return { selected: hit, ...(accessible ? { accessible } : {}) };
	}

	// Step 1: climb from the hit to the nearest meaningful ancestor (following composed ancestry so
	// slotted light-DOM content inside a shadow control reaches that control first).
	let step1: ClimbNode<T> = hit;
	let cursor: ClimbNode<T> | null = hit;
	while (cursor) {
		if (isMeaningfulNode(cursor)) {
			step1 = cursor;
			break;
		}
		cursor = composedOrParent(cursor);
	}

	// Step 2: climb while inside a custom element's shadow root with no other meaningful element
	// outside the subtree we came from.
	let current = step1;
	for (;;) {
		const host = current.shadowHost();
		if (!host || !isCustomTag(host.tag)) break;
		if (hasOtherMeaningfulInShadow(host, current)) break;
		current = host;
	}

	const accessible =
		accessibleOf(step1) ??
		accessibleOf(current) ??
		(isCustomTag(current.tag) ? accessibleOf(soleAccessibleInShadow(current)) : undefined);

	return { selected: current, ...(accessible ? { accessible } : {}) };
}

/** Build a `ClimbNode` lookup map over captured `ElementObservation[]` (for `specimen-point`). */
export function observationClimbTree(
	elements: readonly ElementObservation[],
	slottedParents?: Readonly<Record<string, string>>
): Map<string, ClimbNode<ElementObservation>> {
	const knownRefs = new Set<string>();
	for (const obs of elements) {
		if (obs.ref !== 'root') knownRefs.add(obs.ref);
	}
	const lightChildren = new Map<string, string[]>();
	const shadowChildren = new Map<string, string[]>();
	const parentMap = new Map<string, string | null>();
	const composedParentMap = new Map<string, string | null>();
	const shadowHostMap = new Map<string, string | null>();

	for (const obs of elements) {
		if (obs.ref === 'root') continue;
		const parts = obs.ref.split('/');
		if (parts.length < 2) continue;
		const parentParts = parts.slice(0, -1);
		const directShadow = parentParts[parentParts.length - 1] === 'shadow';
		const parentRef = directShadow ? parentParts.slice(0, -1).join('/') : parentParts.join('/');
		const domParent = parentRef && parentRef !== 'root' ? parentRef : null;
		const assignedSlotRef = slottedParents?.[obs.ref];

		parentMap.set(obs.ref, domParent);
		composedParentMap.set(
			obs.ref,
			assignedSlotRef && knownRefs.has(assignedSlotRef) ? assignedSlotRef : domParent
		);
		if (domParent) {
			const bucket = directShadow ? shadowChildren : lightChildren;
			const list = bucket.get(domParent) ?? [];
			list.push(obs.ref);
			bucket.set(domParent, list);
		}

		const lastShadow = parentParts.lastIndexOf('shadow');
		if (lastShadow > 0) {
			const hostRef = parentParts.slice(0, lastShadow).join('/');
			shadowHostMap.set(obs.ref, hostRef === 'root' ? null : hostRef);
		} else {
			shadowHostMap.set(obs.ref, null);
		}
	}

	const nodes = new Map<string, ClimbNode<ElementObservation>>();
	for (const obs of elements) {
		if (obs.ref === 'root') continue;
		const explicit = obs.attributes.role?.trim().toLowerCase().split(/\s+/)[0];
		const presentational =
			explicit === 'none' ||
			explicit === 'presentation' ||
			(obs.tag === 'img' && obs.attributes.alt === '');
		const rawRole = obs.accessibility?.role;
		const role = rawRole && !IGNORED_ROLES.has(rawRole) ? rawRole : undefined;
		const name = obs.accessibility?.name?.trim() || undefined;
		const node: ClimbNode<ElementObservation> = {
			value: obs,
			tag: obs.tag,
			...(role ? { role } : {}),
			...(name ? { name } : {}),
			ariaHidden: obs.attributes['aria-hidden'] === 'true',
			presentational,
			parent() {
				const ref = parentMap.get(obs.ref);
				return ref ? (nodes.get(ref) ?? null) : null;
			},
			composedParent() {
				const ref = composedParentMap.get(obs.ref);
				return ref ? (nodes.get(ref) ?? null) : null;
			},
			shadowHost() {
				const ref = shadowHostMap.get(obs.ref);
				return ref ? (nodes.get(ref) ?? null) : null;
			},
			shadowChildren() {
				return (shadowChildren.get(obs.ref) ?? [])
					.map((ref) => nodes.get(ref))
					.filter((item): item is ClimbNode<ElementObservation> => item !== undefined);
			},
			children() {
				return (lightChildren.get(obs.ref) ?? [])
					.map((ref) => nodes.get(ref))
					.filter((item): item is ClimbNode<ElementObservation> => item !== undefined);
			},
		};
		nodes.set(obs.ref, node);
	}
	return nodes;
}

/** Run the shared two-step climb on a captured `ElementObservation` identified by `ref`. */
export function climbObservation(
	elements: readonly ElementObservation[],
	ref: string,
	options: ClimbOptions = {}
): {
	element: ElementObservation;
	accessible?: { role?: string; name?: string; from: ElementObservation };
} | null {
	const tree = observationClimbTree(elements);
	const hit = tree.get(ref);
	if (!hit) return null;
	const result = climbSelection(hit, options);
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

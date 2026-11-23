/**
 * @fileoverview Deterministic ordering and metadata stripping for Violet results (spec §5.6).
 */
import type { Node } from '@lushly-dev/violet-core/types';

export const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sort active nodes in tree pre-order with siblings in creation order (spec §5.6).
 * Falls back to code point order for any orphan or cycle.
 */
export function orderNodesPreOrder(nodes: readonly Node[]): Node[] {
	const active = nodes.filter((node) => !node.deletedAt);
	const byParent = new Map<string | null, Node[]>();
	const ids = new Set(active.map((node) => node.id));

	for (const node of active) {
		const parentKey = node.parentId && ids.has(node.parentId) ? node.parentId : null;
		const bucket = byParent.get(parentKey);
		if (bucket) bucket.push(node);
		else byParent.set(parentKey, [node]);
	}

	const ordered: Node[] = [];
	const visited = new Set<string>();
	const visit = (node: Node): void => {
		if (visited.has(node.id)) return;
		visited.add(node.id);
		ordered.push(node);
		for (const child of byParent.get(node.id) ?? []) {
			visit(child);
		}
	};

	for (const root of byParent.get(null) ?? []) {
		visit(root);
	}
	for (const node of active) {
		if (!visited.has(node.id)) visit(node);
	}
	return ordered;
}

/** Sort an array of objects by string key ascending in code-point order. */
export function sortByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
	return [...items].sort((a, b) => byCodePoint(keyOf(a), keyOf(b)));
}

/** Order node ids using the document's pre-order node rank, falling back to code point. */
export function orderNodeIds(nodeIds: readonly string[], orderedNodes: readonly Node[]): string[] {
	const rank = new Map<string, number>();
	orderedNodes.forEach((node, index) => {
		rank.set(node.id, index);
	});
	return [...nodeIds].sort((a, b) => {
		const ra = rank.get(a);
		const rb = rank.get(b);
		if (ra !== undefined && rb !== undefined) return ra - rb;
		if (ra !== undefined) return -1;
		if (rb !== undefined) return 1;
		return byCodePoint(a, b);
	});
}

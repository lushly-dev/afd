import type { Node } from '@lushly-dev/violet-core/types';
import type { CommandContext } from '../registry.js';

/**
 * Order nodes depth-first so each subtree is contiguous and parents precede
 * children. Siblings are ordered by name for a stable layout.
 */
export function orderDepthFirst(nodes: Node[], rootIds: string[]): Node[] {
	const byParent = new Map<string | null, Node[]>();
	for (const node of nodes) {
		const siblings = byParent.get(node.parentId) ?? [];
		siblings.push(node);
		byParent.set(node.parentId, siblings);
	}
	for (const siblings of byParent.values()) {
		siblings.sort((a, b) => a.name.localeCompare(b.name));
	}

	const byId = new Map(nodes.map((node) => [node.id, node]));
	const ordered: Node[] = [];
	const visit = (node: Node) => {
		ordered.push(node);
		for (const child of byParent.get(node.id) ?? []) {
			visit(child);
		}
	};
	for (const rootId of rootIds) {
		const root = byId.get(rootId);
		if (root) {
			visit(root);
		}
	}
	return ordered;
}

/**
 * The live (non-deleted) nodes of one subtree, or of every tree when `rootId`
 * is omitted, in depth-first order. Nodes whose parent is missing or deleted
 * count as roots. Returns null when `rootId` names no live node.
 */
export async function selectSubtree(
	db: CommandContext['db'],
	rootId?: string,
): Promise<Node[] | null> {
	const live = (await db.listNodes()).filter((node) => !node.deletedAt);
	if (rootId) {
		const root = live.find((node) => node.id === rootId);
		return root ? orderDepthFirst(live, [root.id]) : null;
	}
	const liveIds = new Set(live.map((node) => node.id));
	const rootIds = live
		.filter((node) => !node.parentId || !liveIds.has(node.parentId))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((node) => node.id);
	return orderDepthFirst(live, rootIds);
}

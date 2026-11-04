/**
 * @fileoverview `tree`'s reader (phase 2 specification, 7.4 and 8.3): what a `tree` sidebar's command
 * returns, `{ items: Array<{ id; title; description?; children? }> }`, to a depth of 8 and 2,000 nodes, each id once, or
 * `SIDEBAR_RESULT_INVALID`, shown in the part. Read field by field, as the shell reads an app's result: it
 * is untrusted text. Until the documents section brings `loam-tree` (documents specification, step 11),
 * an app's tree shows in `loam-list`, depth first, each row indented by its depth.
 */

import type { LoamListFailure, LoamListItem } from '../elements/list.js';

export const TREE_MAX_DEPTH = 8;
export const TREE_MAX_NODES = 2_000;

const INVALID: LoamListFailure = {
	message: `This sidebar's tree is not one the shell can show: at most ${TREE_MAX_DEPTH} levels and ${TREE_MAX_NODES} items, each with an id of its own and a title (SIDEBAR_RESULT_INVALID)`,
	suggestion: "Report this to the app's owner.",
};

/** The rows of a tree, depth first, or why it cannot be shown. */
export function readTree(
	data: unknown
): { items: LoamListItem[]; failure?: undefined } | { failure: LoamListFailure } {
	const items: LoamListItem[] = [];
	const ids = new Set<string>();
	const visit = (nodes: unknown, depth: number, parent?: string): boolean => {
		if (!Array.isArray(nodes) || depth >= TREE_MAX_DEPTH) return false;
		for (const node of nodes) {
			if (typeof node !== 'object' || node === null) return false;
			const { id, title, description, children } = node as Record<string, unknown>;
			if (typeof id !== 'string' || typeof title !== 'string') return false;
			if (description !== undefined && typeof description !== 'string') return false;
			if (items.length >= TREE_MAX_NODES || ids.has(id)) return false;
			ids.add(id);
			items.push({
				id,
				title,
				...(description !== undefined ? { description } : {}),
				depth,
				...(parent !== undefined ? { parent } : {}),
			});
			if (children !== undefined && !visit(children, depth + 1, title)) return false;
		}
		return true;
	};
	const root = (data as { items?: unknown } | null | undefined)?.items;
	return visit(root, 0) ? { items } : { failure: INVALID };
}

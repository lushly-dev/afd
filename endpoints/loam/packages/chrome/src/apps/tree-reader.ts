/**
 * @fileoverview `tree`'s reader (phase 2 specification, 7.4 and 8.3): what a `tree` sidebar's command
 * returns, `{ items: Array<{ id; title; description?; children? }> }`, to a depth of 8 and 2,000 nodes, each id once, or
 * `SIDEBAR_RESULT_INVALID`, shown in the part. Read field by field, as the shell reads an app's result: it
 * is untrusted text. Each node is copied with only the fields it may hold, for `loam-tree` (documents
 * specification, step 11), which shows it nested, in place of `loam-list`'s indented rows.
 */

import type { LoamTreeFailure, LoamTreeNode } from '../sections/tree.js';

export const TREE_MAX_DEPTH = 8;
export const TREE_MAX_NODES = 2_000;

const INVALID: LoamTreeFailure = {
	message: `This sidebar's tree is not one the shell can show: at most ${TREE_MAX_DEPTH} levels and ${TREE_MAX_NODES} items, each with an id of its own and a title (SIDEBAR_RESULT_INVALID)`,
	suggestion: "Report this to the app's owner.",
};

/** The nodes of a tree, as read, or why it cannot be shown. */
export function readTree(
	data: unknown
): { items: LoamTreeNode[]; failure?: undefined } | { failure: LoamTreeFailure } {
	const ids = new Set<string>();
	const visit = (nodes: unknown, depth: number): LoamTreeNode[] | undefined => {
		if (!Array.isArray(nodes) || depth >= TREE_MAX_DEPTH) return undefined;
		const read: LoamTreeNode[] = [];
		for (const node of nodes) {
			if (typeof node !== 'object' || node === null) return undefined;
			const { id, title, description, children } = node as Record<string, unknown>;
			if (typeof id !== 'string' || typeof title !== 'string') return undefined;
			if (description !== undefined && typeof description !== 'string') return undefined;
			if (ids.size >= TREE_MAX_NODES || ids.has(id)) return undefined;
			ids.add(id);
			const kept: LoamTreeNode = {
				id,
				title,
				...(description !== undefined ? { description } : {}),
			};
			if (children !== undefined) {
				const below = visit(children, depth + 1);
				if (!below) return undefined;
				kept.children = below;
			}
			read.push(kept);
		}
		return read;
	};
	const items = visit((data as { items?: unknown } | null | undefined)?.items, 0);
	return items ? { items } : { failure: INVALID };
}

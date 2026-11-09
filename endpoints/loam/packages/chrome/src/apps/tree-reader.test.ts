/** `tree`'s reader, at its bounds (phase 2 specification, 7.4). */

import { describe, expect, it } from 'vitest';
import { readTree, TREE_MAX_DEPTH, TREE_MAX_NODES } from './tree-reader.js';

const chain = (depth: number): unknown => {
	let node: Record<string, unknown> = { id: `n${depth}`, title: `Level ${depth}` };
	for (let level = depth - 1; level >= 0; level--) {
		node = { id: `n${level}`, title: `Level ${level}`, children: [node] };
	}
	return { items: [node] };
};

describe('readTree', () => {
	it('reads a tree, each node with only the fields it may hold', () => {
		expect(
			readTree({
				items: [
					{
						id: 'a',
						title: 'A',
						extra: 'dropped',
						children: [{ id: 'a1', title: 'A1', description: 'one' }],
					},
					{ id: 'b', title: 'B' },
				],
			})
		).toEqual({
			items: [
				{ id: 'a', title: 'A', children: [{ id: 'a1', title: 'A1', description: 'one' }] },
				{ id: 'b', title: 'B' },
			],
		});
	});

	it('holds eight levels and 2,000 nodes, and refuses one more of either', () => {
		expect(readTree(chain(TREE_MAX_DEPTH - 1)).failure).toBeUndefined();
		expect(readTree(chain(TREE_MAX_DEPTH)).failure?.message).toContain('SIDEBAR_RESULT_INVALID');
		const flat = (count: number) => ({
			items: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, title: 'N' })),
		});
		expect(readTree(flat(TREE_MAX_NODES)).failure).toBeUndefined();
		expect(readTree(flat(TREE_MAX_NODES + 1)).failure).toBeDefined();
	});

	it('refuses what is not a tree: no items, a node without an id or title, markup kept as text', () => {
		expect(readTree(null).failure).toBeDefined();
		expect(readTree({ items: [{ title: 'No id' }] }).failure).toBeDefined();
		expect(readTree({ items: [{ id: 'x', title: 7 }] }).failure).toBeDefined();
		expect(readTree({ items: [{ id: 'x', title: 'X', children: 'no' }] }).failure).toBeDefined();
		// An id is a row's selection, so a tree holds each once.
		expect(
			readTree({ items: [{ id: 'x', title: 'X', children: [{ id: 'x', title: 'Again' }] }] })
				.failure
		).toBeDefined();
		expect(readTree({ items: [{ id: 'x', title: '<img src=x>' }] })).toEqual({
			items: [{ id: 'x', title: '<img src=x>' }],
		});
	});
});

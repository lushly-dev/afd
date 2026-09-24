/**
 * @fileoverview Enumerate item pairs that share at least one term.
 *
 * Used by the pairwise surface rules: with an inverted index, a pair's dot
 * product is accumulated only through the terms the two items share, so
 * pairs with nothing in common cost nothing and no per-pair objects are made.
 */

/**
 * Call `visit(i, j, dot)` for every pair `i < j` whose weighted term maps share
 * at least one term, in ascending `(i, j)` order. `dot` is the sum over shared
 * terms of the product of the two weights.
 */
export function forEachSharedTermPair(
	items: ReadonlyArray<ReadonlyMap<string, number>>,
	visit: (i: number, j: number, dot: number) => void
): void {
	// Inverted index: term -> item indices (ascending) and weights
	const termIds = new Map<string, number>();
	const postingItems: number[][] = [];
	const postingWeights: number[][] = [];
	const itemTerms: Array<Array<[termId: number, weight: number]>> = items.map((terms, index) =>
		Array.from(terms, ([term, weight]) => {
			let id = termIds.get(term);
			if (id === undefined) {
				id = postingItems.length;
				termIds.set(term, id);
				postingItems.push([]);
				postingWeights.push([]);
			}
			postingItems[id]?.push(index);
			postingWeights[id]?.push(weight);
			return [id, weight];
		})
	);

	// Items are visited in ascending order, so for each term the cursor sits on
	// the current item's own entry; later entries are the items after it.
	const cursor = new Int32Array(postingItems.length);
	const dots = new Float64Array(items.length);

	for (let i = 0; i < items.length; i++) {
		for (const [termId, weight] of itemTerms[i] ?? []) {
			const others = postingItems[termId] ?? [];
			const otherWeights = postingWeights[termId] ?? [];
			const start = (cursor[termId] ?? 0) + 1;
			for (let k = start; k < others.length; k++) {
				const j = others[k] ?? 0;
				dots[j] = (dots[j] ?? 0) + weight * (otherWeights[k] ?? 0);
			}
			cursor[termId] = start;
		}
		for (let j = i + 1; j < items.length; j++) {
			const dot = dots[j] ?? 0;
			if (dot !== 0) {
				visit(i, j, dot);
				dots[j] = 0;
			}
		}
	}
}

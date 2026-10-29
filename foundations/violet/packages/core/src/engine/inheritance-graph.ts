import type { Database } from '../storage.js';

/**
 * Maximum number of nested node resolutions before the resolver gives up.
 * Real hierarchies are shallow; this is a safety net, not a feature limit.
 */
export const MAX_RESOLUTION_DEPTH = 64;

/**
 * Find a dependency path from `startId` to `targetId`.
 *
 * Resolving a node depends on:
 * - its parent (ancestry chain),
 * - every node it includes (mixins),
 * - every node it copies tokens from (`copy` operations).
 *
 * Adding a new dependency edge `target -> start` creates a cycle exactly when
 * `target` is already reachable from `start` through these edges (or when
 * `start === target`). A visited set keeps the search finite even if the stored
 * graph already contains a cycle.
 *
 * @returns The node ids from `startId` to `targetId` (inclusive), or null when
 * `targetId` is not reachable.
 */
export async function findDependencyPath(
	db: Database,
	startId: string,
	targetId: string,
): Promise<string[] | null> {
	const visited = new Set<string>();

	const visit = async (nodeId: string, path: string[]): Promise<string[] | null> => {
		const nextPath = [...path, nodeId];
		if (nodeId === targetId) {
			return nextPath;
		}
		if (visited.has(nodeId)) {
			return null;
		}
		visited.add(nodeId);

		const node = await db.getNode(nodeId);
		if (!node) {
			return null;
		}

		const dependencies: string[] = [];
		if (node.parentId) {
			dependencies.push(node.parentId);
		}
		for (const includeId of node.includes ?? []) {
			dependencies.push(includeId);
		}
		const operations = await db.getOperations(nodeId);
		for (const op of operations) {
			if (op.type === 'copy' && op.fromNode) {
				dependencies.push(op.fromNode);
			}
		}

		for (const dependencyId of dependencies) {
			const found = await visit(dependencyId, nextPath);
			if (found) {
				return found;
			}
		}
		return null;
	};

	return visit(startId, []);
}

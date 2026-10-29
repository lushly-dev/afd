import { SPECIMEN_COMPONENTS, SPECIMEN_ROLE_NAMES } from '@lushly-dev/violet-core/css';
import type { Node } from '@lushly-dev/violet-core/types';
import type { OperationRecord } from '@lushly-dev/violet-core/types';
import { selectSubtree } from '../node/scope.js';
import type { Database } from '../registry.js';
import { collectDefinitions } from '../token/definitions.js';

/** A live node and the root of its tree, where the specimen map is stored */
export async function treeRootOf(
	db: Database,
	nodeId: string,
): Promise<{ node: Node; rootId: string } | null> {
	const node = await db.getNode(nodeId);
	if (!node || node.deletedAt) return null;
	const chain = await db.getAncestryChain(nodeId);
	return { node, rootId: chain[0] ?? nodeId };
}

/**
 * Every token id defined in a tree: added or copied by one of its nodes or by
 * a node they mix in. A map may point at any of them.
 */
export async function treeTokenIds(db: Database, rootId: string): Promise<Set<string>> {
	const nodes = (await selectSubtree(db, rootId)) ?? [];
	const ids = [...new Set([...nodes.map((node) => node.id), ...nodes.flatMap((n) => n.includes)])];
	const opsByNode = new Map<string, OperationRecord[]>();
	for (const id of ids) opsByNode.set(id, await db.getOperations(id));
	return new Set(collectDefinitions(ids, opsByNode).keys());
}

/** Known components and roles, for error suggestions */
export const KNOWN_COMPONENTS = Object.keys(SPECIMEN_COMPONENTS);
export const KNOWN_ROLES = SPECIMEN_ROLE_NAMES;

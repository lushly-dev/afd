import type { OperationRecord } from '@lushly-dev/violet-core/types';
import { type TokenMetadata, TokenMetadataSchema } from '@lushly-dev/violet-core/types';

/** Where and how a token is defined: its `add` operation's node and metadata. */
export interface TokenDefinitionSite {
	id: string;
	definedAt: string;
	metadata: TokenMetadata;
}

function parseMetadata(raw: string | null): TokenMetadata {
	if (!raw) return TokenMetadataSchema.parse({});
	try {
		return TokenMetadataSchema.parse(JSON.parse(raw));
	} catch {
		return TokenMetadataSchema.parse({});
	}
}

/**
 * Token definitions from the `add` operations of the given nodes. Pass nodes
 * root-most first: the first definition of an id wins, matching how the
 * resolver ignores a later `add` of a token that already exists.
 *
 * Tokens created by a copy (the target id did not exist) take the copied
 * token's metadata.
 */
export function collectDefinitions(
	nodeIds: string[],
	opsByNode: Map<string, OperationRecord[]>,
): Map<string, TokenDefinitionSite> {
	const definitions = new Map<string, TokenDefinitionSite>();
	for (const nodeId of nodeIds) {
		for (const op of opsByNode.get(nodeId) ?? []) {
			if (op.type === 'add' && !definitions.has(op.tokenId)) {
				definitions.set(op.tokenId, {
					id: op.tokenId,
					definedAt: nodeId,
					metadata: parseMetadata(op.metadata),
				});
			}
		}
	}
	for (const nodeId of nodeIds) {
		for (const op of opsByNode.get(nodeId) ?? []) {
			const target = op.asTokenId ?? op.tokenId;
			if (op.type === 'copy' && !definitions.has(target)) {
				const source = definitions.get(op.tokenId);
				definitions.set(target, {
					id: target,
					definedAt: nodeId,
					metadata: source?.metadata ?? TokenMetadataSchema.parse({}),
				});
			}
		}
	}
	return definitions;
}

/**
 * Order nodes for `collectDefinitions`: ancestors first, then the main
 * hierarchy, then mixins. A mixin that re-adds a token (e.g. a high-contrast
 * text colour) must not be reported as where that token is defined.
 */
export function definitionOrder(
	ancestors: string[],
	nodes: Array<{ id: string; includes?: string[] }>,
	extra: string[] = [],
): string[] {
	const mixins = new Set(nodes.flatMap((node) => node.includes ?? []));
	const ids = [...ancestors, ...nodes.map((node) => node.id), ...extra];
	const unique = [...new Set(ids)];
	return [...unique.filter((id) => !mixins.has(id)), ...unique.filter((id) => mixins.has(id))];
}

/** The token an operation changes on its node (a copy may rename it). */
export function operationTarget(op: OperationRecord): string {
	return op.type === 'copy' && op.asTokenId ? op.asTokenId : op.tokenId;
}

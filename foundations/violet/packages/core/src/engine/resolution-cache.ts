import type { Database } from '../storage.js';
import type { Node } from '../types/node.js';
import type { OperationRecord } from '../types/operation.js';
import type { ResolvedToken, TokenMetadata, TokenValue } from '../types/token.js';

/**
 * What a resolution cache is scoped to: a store and, when one execution shares it, its
 * cache. The Violet AFD command context satisfies it.
 */
export interface ResolutionScope {
	db: Database;
	resolutionCache?: ResolutionCache;
}

/** One token while a chain is walked, before references are followed */
export interface TokenStateEntry {
	value: TokenValue;
	metadata: TokenMetadata;
	resolvedAt: string;
	history: Array<{
		nodeId: string;
		operation: string;
		value?: TokenValue;
		fromNode?: string;
		fromToken?: string;
	}>;
}

/** Tokens after walking one chain (root first) */
export interface ChainState {
	tokens: Map<string, TokenStateEntry>;
	/**
	 * Nesting the walk needed below its own frame: the height of its deepest
	 * include, copy source or reset target (0 when it has none). A cached
	 * state reused on a deeper stack is checked against MAX_RESOLUTION_DEPTH
	 * with it, as if it had been walked there (#116).
	 */
	height: number;
}

/** A resolved include, copy source or reset target */
export interface ResolvedDependency {
	tokens: Map<string, ResolvedToken>;
	/** Resolution frames it needed, its own included: 1 + its chain state's height */
	height: number;
}

/**
 * Store reads and resolved chains for one command execution.
 *
 * Resolving many nodes (tokens.matrix, nodes.graph --token, changes.impact)
 * walks the same ancestors, mix-ins and copy sources again and again. With a
 * cache, each node's operations are read once, and a child starts from its
 * parent's resolved tokens instead of walking the whole chain again.
 *
 * Nothing is invalidated, so a cache must not outlive the reads it was made
 * for: create one inside a read-only command (see withResolutionCache), after
 * any writes that command makes, and never keep one on a shared context.
 */
export class ResolutionCache {
	private readonly operations = new Map<string, Promise<OperationRecord[]>>();
	private readonly nodes = new Map<string, Promise<Node | null>>();
	private readonly chains = new Map<string, Promise<string[]>>();
	/** Chain state by chain key (see chainKey) */
	readonly states = new Map<string, ChainState>();
	/** Resolved tokens without lineage by chain key, for includes, copies and resets */
	readonly dependencies = new Map<string, ResolvedDependency>();

	constructor(readonly db: Database) {}

	/** A node's operations, sorted by sequence. Treat the array as read-only. */
	getOperations(nodeId: string): Promise<OperationRecord[]> {
		return this.memo(this.operations, nodeId, async () =>
			[...(await this.db.getOperations(nodeId))].sort((a, b) => a.sequence - b.sequence),
		);
	}

	getNode(nodeId: string): Promise<Node | null> {
		return this.memo(this.nodes, nodeId, () => this.db.getNode(nodeId));
	}

	async getAncestryChain(nodeId: string): Promise<string[]> {
		return [...(await this.memo(this.chains, nodeId, () => this.db.getAncestryChain(nodeId)))];
	}

	private memo<T>(store: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
		let pending = store.get(key);
		if (!pending) {
			pending = load();
			store.set(key, pending);
			// A failed read is not cached, so the error is not replayed
			pending.catch(() => store.delete(key));
		}
		return pending;
	}
}

/** Key for a chain of node ids (root first, the resolved node last) */
export function chainKey(chain: string[]): string {
	return chain.join('\u0000');
}

/** The context's cache, when it was made for the context's own store */
export function resolutionCacheFor(context: ResolutionScope): ResolutionCache | undefined {
	const cache = context.resolutionCache;
	return cache && cache.db === context.db ? cache : undefined;
}

/**
 * A context that carries a resolution cache for its store: the context itself
 * when it already has one, otherwise a copy with a new cache. Pass the result to
 * nested command calls so they share it; the caller's context is not changed.
 */
export function withResolutionCache<TContext extends ResolutionScope>(
	context: TContext,
): TContext & { resolutionCache: ResolutionCache } {
	const cache = resolutionCacheFor(context);
	if (cache) {
		return { ...context, resolutionCache: cache };
	}
	return { ...context, resolutionCache: new ResolutionCache(context.db) };
}

import type { Database } from '../storage.js';
import type { Node } from '../types/node.js';
import type { OperationRecord } from '../types/operation.js';
import type { ResolvedToken, TokenReferenceError, TokenValue } from '../types/token.js';
import { TokenMetadataSchema } from '../types/token.js';
import { MAX_RESOLUTION_DEPTH } from './inheritance-graph.js';
import {
	type ChainState,
	type ResolutionCache,
	type ResolvedDependency,
	type TokenStateEntry,
	chainKey,
} from './resolution-cache.js';

/** Get default metadata with all required fields */
const getDefaultMetadata = (): TokenStateEntry['metadata'] => TokenMetadataSchema.parse({});

/**
 * Thrown internally when resolution detects a cycle or exceeds the depth cap.
 * Always caught in the command handler and converted to a failure result.
 */
export class InheritanceResolutionError extends Error {}

/** Options for resolveInheritance */
export interface ResolveOptions {
	/**
	 * Node ids currently being resolved (the path from the original node to this
	 * call). Internal: used to detect cycles through includes and copies.
	 */
	resolving?: string[];
	/** Reuse store reads and resolved chains within one command execution */
	cache?: ResolutionCache;
}

/** Store reads the walk needs; served by the cache when there is one */
interface StoreReads {
	getOperations(nodeId: string): Promise<OperationRecord[]>;
	getNode(nodeId: string): Promise<Node | null>;
	getAncestryChain(nodeId: string): Promise<string[]>;
}

function directReads(db: Database): StoreReads {
	return {
		getOperations: async (nodeId) =>
			(await db.getOperations(nodeId)).sort((a, b) => a.sequence - b.sequence),
		getNode: (nodeId) => db.getNode(nodeId),
		getAncestryChain: (nodeId) => db.getAncestryChain(nodeId),
	};
}

/**
 * Resolve tokens through inheritance chain
 *
 * `options.resolving` is the stack of node ids currently being resolved (the
 * path from the original node to this call). Re-entering a node that is already
 * on the stack means the graph has a cycle. Nodes reached twice via different,
 * non-nested paths (diamond includes) are fine because they are popped on exit.
 *
 * With `options.cache`, store reads are made once per node and a node's chain
 * starts from its parent's cached state. The result is the same as without it.
 */
export async function resolveInheritance(
	db: Database,
	nodeId: string,
	ancestryChain: string[],
	includeLineage: boolean,
	options: ResolveOptions = {},
): Promise<ResolvedToken[]> {
	const state = await resolveChainState(db, nodeId, ancestryChain, options);
	return toResolvedTokens(state.tokens, [...ancestryChain, nodeId], includeLineage);
}

/**
 * Walk a node's chain without following references or describing tokens: the
 * state resolveInheritance describes. Pass it to ChainTokens to describe only
 * the tokens a caller needs. With a cache the state is shared, so treat it as
 * read-only. Throws InheritanceResolutionError like resolveInheritance.
 */
export async function resolveChainState(
	db: Database,
	nodeId: string,
	ancestryChain: string[],
	options: ResolveOptions = {},
): Promise<ChainState> {
	const { resolving = [], cache } = options;
	if (resolving.includes(nodeId)) {
		throw new InheritanceResolutionError(
			`Circular reference detected while resolving '${nodeId}': ${[...resolving, nodeId].join(' -> ')}`,
		);
	}
	if (resolving.length >= MAX_RESOLUTION_DEPTH) {
		throw depthExceeded(nodeId, resolving);
	}
	const walk: Walk = {
		db,
		reads: cache ?? directReads(db),
		cache,
		stack: [...resolving, nodeId],
	};

	// Walk ancestry chain from root to target
	const fullChain = [...ancestryChain, nodeId];
	return cache
		? cachedChainState(walk, fullChain)
		: walkChain(walk, fullChain, { tokens: new Map(), height: 0 }, 0);
}

function depthExceeded(nodeId: string, resolving: string[], cachedHeight?: number) {
	const cached =
		cachedHeight === undefined
			? ''
			: ` (its cached result needs ${cachedHeight} level(s) from here)`;
	return new InheritanceResolutionError(
		`Inheritance depth exceeded ${MAX_RESOLUTION_DEPTH} while resolving '${nodeId}'${cached}: ${[...resolving, nodeId].join(' -> ')}`,
	);
}

/**
 * A cached result needing `height` frames (its own included) on top of
 * `resolving` would have hit the depth cap had it been resolved there, so it
 * fails the same way.
 * Without this, a node resolved shallowly first (e.g. an earlier matrix
 * column) would let a deeper include chain through (#116).
 */
function checkCachedDepth(resolving: string[], nodeId: string, height: number): void {
	if (resolving.length + height > MAX_RESOLUTION_DEPTH) {
		throw depthExceeded(nodeId, resolving, height);
	}
}

/** One resolution: where to read from and which nodes are on the stack */
interface Walk {
	db: Database;
	reads: StoreReads;
	cache: ResolutionCache | undefined;
	stack: string[];
}

/**
 * The state after walking `chain`, from the cache or computed and cached. A
 * child chain starts from a copy of its parent chain's state, so each node's
 * own operations are applied once per command run. That is exact because a
 * node's operations never depend on which descendant is being resolved (see
 * resetTarget). The returned state is shared: copy it before changing it.
 */
async function cachedChainState(walk: Walk, chain: string[]): Promise<ChainState> {
	const cache = walk.cache as ResolutionCache;
	const key = chainKey(chain);
	const cached = cache.states.get(key);
	if (cached) {
		// The stack ends with this chain's node; its own frame counts as one level
		checkCachedDepth(walk.stack.slice(0, -1), chain[chain.length - 1], cached.height + 1);
		return cached;
	}
	const state =
		chain.length > 1
			? await walkChain(
					walk,
					chain,
					copyState(await cachedChainState(walk, chain.slice(0, -1))),
					chain.length - 1,
				)
			: await walkChain(walk, chain, { tokens: new Map(), height: 0 }, 0);
	cache.states.set(key, state);
	return state;
}

function copyState(state: ChainState): ChainState {
	const tokens = new Map<string, TokenStateEntry>();
	for (const [id, entry] of state.tokens) {
		tokens.set(id, { ...entry, history: [...entry.history] });
	}
	return { tokens, height: state.height };
}

/**
 * Resolve a node another node depends on (an include, a copy source or a reset
 * target), without lineage. Cached per chain when the walk has a cache.
 */
async function resolveDependency(
	walk: Walk,
	nodeId: string,
	ancestryChain: string[],
): Promise<ResolvedDependency> {
	const resolve = async (): Promise<ResolvedDependency> => {
		const state = await resolveChainState(walk.db, nodeId, ancestryChain, {
			resolving: walk.stack,
			cache: walk.cache,
		});
		const tokens = toResolvedTokens(state.tokens, [...ancestryChain, nodeId], false);
		return { tokens: new Map(tokens.map((token) => [token.id, token])), height: 1 + state.height };
	};
	if (!walk.cache) {
		return resolve();
	}
	const key = chainKey([...ancestryChain, nodeId]);
	let resolved = walk.cache.dependencies.get(key);
	if (resolved) {
		checkCachedDepth(walk.stack, nodeId, resolved.height);
	} else {
		resolved = await resolve();
		walk.cache.dependencies.set(key, resolved);
	}
	return resolved;
}

/** Resolve a dependency and note the nesting it needed on the state being walked */
async function dependencyTokens(
	walk: Walk,
	state: ChainState,
	nodeId: string,
	ancestryChain: string[],
): Promise<Map<string, ResolvedToken>> {
	const { tokens, height } = await resolveDependency(walk, nodeId, ancestryChain);
	state.height = Math.max(state.height, height);
	return tokens;
}

/** Apply the operations and includes of `fullChain[from..]` to `state` */
async function walkChain(
	walk: Walk,
	fullChain: string[],
	state: ChainState,
	from: number,
): Promise<ChainState> {
	const tokenMap = state.tokens;

	for (let index = from; index < fullChain.length; index++) {
		const currentNodeId = fullChain[index];
		// The ancestors of the node whose operations these are, root first
		const ancestors = fullChain.slice(0, index);
		const operations = await walk.reads.getOperations(currentNodeId);

		for (const op of operations) {
			switch (op.type) {
				case 'add': {
					if (!tokenMap.has(op.tokenId)) {
						const value = op.value ? JSON.parse(op.value) : null;
						const metadata = op.metadata
							? { ...getDefaultMetadata(), ...JSON.parse(op.metadata) }
							: getDefaultMetadata();
						tokenMap.set(op.tokenId, {
							value,
							metadata,
							resolvedAt: currentNodeId,
							history: [{ nodeId: currentNodeId, operation: 'add', value }],
						});
					}
					break;
				}

				case 'override': {
					const existing = tokenMap.get(op.tokenId);
					const value = op.value ? JSON.parse(op.value) : null;
					if (existing) {
						existing.value = value;
						existing.resolvedAt = currentNodeId;
						existing.history.push({
							nodeId: currentNodeId,
							operation: 'override',
							value,
						});
					} else {
						// Override without existing = effectively an add
						tokenMap.set(op.tokenId, {
							value,
							metadata: getDefaultMetadata(),
							resolvedAt: currentNodeId,
							history: [{ nodeId: currentNodeId, operation: 'override', value }],
						});
					}
					break;
				}

				case 'subtract': {
					const existing = tokenMap.get(op.tokenId);
					if (existing) {
						existing.history.push({
							nodeId: currentNodeId,
							operation: 'subtract',
						});
						tokenMap.delete(op.tokenId);
					}
					break;
				}

				case 'reset': {
					// Reset to the value the target ancestor resolves
					const targetAncestor = resetTarget(op, ancestors);
					if (targetAncestor) {
						const ancestorResolved = await dependencyTokens(
							walk,
							state,
							targetAncestor,
							ancestors.slice(0, ancestors.indexOf(targetAncestor)),
						);
						const ancestorToken = ancestorResolved.get(op.tokenId);
						if (ancestorToken) {
							const existing = tokenMap.get(op.tokenId);
							if (existing) {
								existing.value = ancestorToken.value;
								existing.resolvedAt = targetAncestor;
								existing.history.push({
									nodeId: currentNodeId,
									operation: 'reset',
									value: ancestorToken.value,
									fromNode: targetAncestor,
								});
							}
						}
					}
					break;
				}

				case 'copy': {
					// Copy from another node
					const sourceNode = await walk.reads.getNode(op.fromNode || '');
					if (sourceNode) {
						const sourceAncestry = await walk.reads.getAncestryChain(op.fromNode || '');
						const sourceResolved = await dependencyTokens(
							walk,
							state,
							op.fromNode || '',
							sourceAncestry,
						);
						const sourceToken = sourceResolved.get(op.tokenId);
						if (sourceToken) {
							const targetId = op.asTokenId || op.tokenId;
							// Re-resolved from the source on every read, so the copy follows it
							const step = {
								nodeId: currentNodeId,
								operation: 'copy',
								value: sourceToken.value,
								fromNode: op.fromNode || '',
								...(targetId !== op.tokenId ? { fromToken: op.tokenId } : {}),
							};
							const existing = tokenMap.get(targetId);
							if (existing) {
								existing.value = sourceToken.value;
								existing.metadata = sourceToken.metadata;
								existing.resolvedAt = currentNodeId;
								existing.history.push(step);
							} else {
								tokenMap.set(targetId, {
									value: sourceToken.value,
									metadata: sourceToken.metadata,
									resolvedAt: currentNodeId,
									history: [step],
								});
							}
						}
					}
					break;
				}
			}
		}

		// Process includes (mixins) for the current node
		const currentNode = await walk.reads.getNode(currentNodeId);
		if (currentNode?.includes && currentNode.includes.length > 0) {
			for (const includeId of currentNode.includes) {
				const includeAncestry = await walk.reads.getAncestryChain(includeId);
				const includeResolved = await dependencyTokens(walk, state, includeId, includeAncestry);

				for (const token of includeResolved.values()) {
					const existing = tokenMap.get(token.id);
					if (currentNode.includePolicy === 'override' || !existing) {
						const step = {
							nodeId: currentNodeId,
							operation: 'include',
							value: token.value,
							fromNode: includeId,
						};
						tokenMap.set(token.id, {
							value: token.value,
							metadata: token.metadata,
							resolvedAt: token.resolvedAt,
							history: existing ? [...existing.history, step] : [step],
						});
					}
				}
			}
		}
	}

	return state;
}

/**
 * The ancestor a stored reset takes its value from, computed from the chain of
 * the node that stores it (`ancestors`, root first), so the reset lands the
 * same way for that node and for every descendant resolved through it (#88):
 *
 * - `toAncestor` set: that node, when it is an ancestor of the storing node.
 * - No `toAncestor`: the storing node's root. `token.reset` always stores a
 *   target, so this only comes from direct store writes and older data.
 * - Otherwise null, and the reset does nothing: a reset on a root (it has no
 *   ancestor), or to a node that is not an ancestor (e.g. after a re-parent).
 *   `analyze.health` flags these as `inert-reset`.
 */
export function resetTarget(op: OperationRecord, ancestors: readonly string[]): string | null {
	const target = op.toAncestor || ancestors[0];
	return target && ancestors.includes(target) ? target : null;
}

/** Follow references and describe each token of a walked chain */
function toResolvedTokens(
	tokenMap: Map<string, TokenStateEntry>,
	fullChain: string[],
	includeLineage: boolean,
): ResolvedToken[] {
	// Follow references against this node's own token map, so a child that
	// overrides an aliased token changes every token that points at it.
	const references = new ReferenceResolver(tokenValues(tokenMap));

	// Convert to ResolvedToken array
	return Array.from(tokenMap.entries()).map(([id, data]) =>
		toResolvedToken(id, data, references.resolve(id), fullChain, includeLineage),
	);
}

function tokenValues(tokenMap: Map<string, TokenStateEntry>): Map<string, TokenValue> {
	return new Map(Array.from(tokenMap.entries()).map(([id, data]) => [id, data.value]));
}

function toResolvedToken(
	id: string,
	data: TokenStateEntry,
	reference: ReferenceResult,
	fullChain: string[],
	includeLineage: boolean,
): ResolvedToken {
	const aliasOf = parseReference(data.value)?.ref;
	return {
		id,
		value: data.value,
		resolvedValue: resolveValue(reference.ok ? reference.value : data.value),
		finalValue: reference.ok ? reference.value : data.value,
		...(aliasOf ? { aliasOf } : {}),
		...(reference.ok ? {} : { referenceError: reference.error }),
		metadata: data.metadata,
		resolvedAt: data.resolvedAt,
		inheritanceChain: fullChain,
		// A copy, so callers can't change a cached chain's history
		operationHistory: includeLineage ? [...data.history] : undefined,
	};
}

/**
 * The tokens of one walked chain (see resolveChainState), described on
 * demand: `token(id)` equals the entry resolveInheritance returns for it, but
 * only follows the references that token needs. Matrix pages and token traces
 * describe a few tokens of many nodes, so they skip the rest (#114, #116).
 */
export class ChainTokens {
	readonly #state: ChainState;
	readonly #chain: string[];
	#lazy: ReferenceResolver | undefined;
	#ordered: ReferenceResolver | undefined;

	/** `fullChain`: root first, the resolved node last */
	constructor(state: ChainState, fullChain: string[]) {
		this.#state = state;
		this.#chain = fullChain;
	}

	/** Token ids in the order resolveInheritance lists them */
	ids(): IterableIterator<string> {
		return this.#state.tokens.keys();
	}

	/** The walked entry: value as stored, metadata, where it resolved and its history */
	entry(tokenId: string): Readonly<TokenStateEntry> | undefined {
		return this.#state.tokens.get(tokenId);
	}

	/** `ResolvedToken.finalValue`, without building the token */
	finalValue(tokenId: string): TokenValue | undefined {
		const data = this.#state.tokens.get(tokenId);
		if (!data) return undefined;
		// A failed reference keeps the stored value, whatever the error says
		const reference = this.#lazyReferences().resolve(tokenId);
		return reference.ok ? reference.value : data.value;
	}

	token(tokenId: string, includeLineage = false): ResolvedToken | undefined {
		const data = this.#state.tokens.get(tokenId);
		if (!data) return undefined;
		let reference = this.#lazyReferences().resolve(tokenId);
		if (!reference.ok) {
			// A value doesn't depend on the order tokens are followed in, but an
			// error's path does (a loop is reported from where it was entered), so
			// take errors from a pass in resolveInheritance's order
			reference = this.#orderedReferences().resolve(tokenId);
		}
		return toResolvedToken(tokenId, data, reference, this.#chain, includeLineage);
	}

	#lazyReferences(): ReferenceResolver {
		this.#lazy ??= new ReferenceResolver(tokenValues(this.#state.tokens));
		return this.#lazy;
	}

	#orderedReferences(): ReferenceResolver {
		if (!this.#ordered) {
			this.#ordered = new ReferenceResolver(tokenValues(this.#state.tokens));
			for (const id of this.#state.tokens.keys()) this.#ordered.resolve(id);
		}
		return this.#ordered;
	}
}

/** Matches a DTCG alias that is the whole string, e.g. `{color.brand.primary}` */
const DTCG_ALIAS = /^\{([^{}\s]+)\}$/;

/**
 * Read a value as a single reference: a `{ ref, transform? }` object or a
 * whole-string DTCG alias. Returns null for anything else (literals, composites,
 * strings that only contain braces mid-text).
 */
export function parseReference(value: unknown): { ref: string; transform?: string } | null {
	if (typeof value === 'string') {
		const match = DTCG_ALIAS.exec(value);
		return match ? { ref: match[1] } : null;
	}
	if (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as { ref?: unknown }).ref === 'string' &&
		Object.keys(value).every((key) => key === 'ref' || key === 'transform')
	) {
		const { ref, transform } = value as { ref: string; transform?: unknown };
		return typeof transform === 'string' ? { ref, transform } : { ref };
	}
	return null;
}

type ReferenceResult = { ok: true; value: TokenValue } | { ok: false; error: TokenReferenceError };

class ReferenceFailure extends Error {
	constructor(readonly error: TokenReferenceError) {
		super(error.message);
	}
}

/**
 * Follows references between the tokens of one resolved node. Values are
 * memoized per token; `stack` detects alias loops (a -> b -> a).
 */
class ReferenceResolver {
	private readonly cache = new Map<string, ReferenceResult>();

	constructor(private readonly values: Map<string, TokenValue>) {}

	resolve(tokenId: string): ReferenceResult {
		return this.resolveToken(tokenId, []);
	}

	private resolveToken(tokenId: string, stack: string[]): ReferenceResult {
		const cached = this.cache.get(tokenId);
		if (cached) {
			return cached;
		}
		const path = [...stack, tokenId];
		let result: ReferenceResult;
		try {
			result = { ok: true, value: this.dereference(this.values.get(tokenId) as TokenValue, path) };
		} catch (error) {
			if (!(error instanceof ReferenceFailure)) {
				throw error;
			}
			result = { ok: false, error: error.error };
		}
		this.cache.set(tokenId, result);
		return result;
	}

	/** Replace references in `value` (recursing into composites) with their final values */
	private dereference(value: TokenValue, path: string[]): TokenValue {
		const reference = parseReference(value);
		if (reference) {
			const from = path[path.length - 1];
			if (reference.transform !== undefined) {
				throw new ReferenceFailure({
					code: 'NOT_IMPLEMENTED',
					message: `Token '${from}' references '${reference.ref}' with transform '${reference.transform}', but reference transforms are not supported yet`,
					path,
				});
			}
			if (path.includes(reference.ref)) {
				throw new ReferenceFailure({
					code: 'CIRCULAR_REFERENCE',
					message: `Circular token reference: ${[...path, reference.ref].join(' -> ')}`,
					path: [...path, reference.ref],
				});
			}
			if (!this.values.has(reference.ref)) {
				throw new ReferenceFailure({
					code: 'TOKEN_REFERENCE_NOT_FOUND',
					message: `Token '${from}' references '${reference.ref}', which does not exist in this node`,
					path: [...path, reference.ref],
				});
			}
			const target = this.resolveToken(reference.ref, path);
			if (!target.ok) {
				throw new ReferenceFailure(target.error);
			}
			return target.value;
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.dereference(item, path)) as unknown as TokenValue;
		}
		if (typeof value === 'object' && value !== null) {
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, this.dereference(item, path)]),
			) as TokenValue;
		}
		return value;
	}
}

/**
 * Resolve token value to final string/number
 */
export function resolveValue(value: TokenValue): string | number {
	if (typeof value === 'string' || typeof value === 'number') {
		return value;
	}

	// An unresolved reference (resolveInheritance follows references first and
	// only lands here when one could not be followed) keeps its alias syntax.
	if (typeof value === 'object' && value !== null) {
		if ('ref' in value) {
			return `{${value.ref}}`;
		}
		if ('web' in value) {
			return String(value.web);
		}
		return JSON.stringify(value);
	}

	return String(value);
}

/**
 * Resolve the tokens a node currently has (ancestors, includes, copies and its own
 * operations) keyed by token id. Used by mutation commands to validate that the
 * token they touch exists.
 */
export async function resolveNodeTokenMap(
	db: Database,
	nodeId: string,
	cache?: ResolutionCache,
): Promise<Map<string, ResolvedToken>> {
	const ancestryChain = await (cache ?? db).getAncestryChain(nodeId);
	const tokens = await resolveInheritance(db, nodeId, ancestryChain, false, { cache });
	return new Map(tokens.map((token) => [token.id, token]));
}

/**
 * Resolve the tokens a node inherits from its ancestors only (not its own
 * operations or includes). Empty for a root node.
 */
export async function resolveAncestorTokenMap(
	db: Database,
	parentId: string | null,
): Promise<Map<string, ResolvedToken>> {
	if (!parentId) {
		return new Map();
	}
	return resolveNodeTokenMap(db, parentId);
}

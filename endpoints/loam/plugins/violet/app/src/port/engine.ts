/**
 * @fileoverview Single Violet engine port over `@lushly-dev/violet-afd/worker` (spec §5).
 * Only `src/port/` and `src/interface.ts` import `@lushly-dev/violet-afd` or `@lushly-dev/violet-core`.
 */
import {
	type AppCallContextV1,
	type CommandResult,
	documentContentKey,
	failure,
	success,
} from '@lushly-dev/loam-sdk';
import { checkCssTokenValue } from '@lushly-dev/violet-afd/css';
import {
	createMemoryDatabase,
	type Database,
	initializeWorkerCore,
	registry,
	type CommandContext as VioletCommandContext,
} from '@lushly-dev/violet-afd/worker';
import type {
	AuditEvent,
	Constraint,
	Node,
	OperationRecord,
	TokenMetadata,
	TokenValue,
} from '@lushly-dev/violet-core/types';
import {
	contentDigest,
	parseStoredContent,
	type TreeFile,
	type VioletTreeContentV1,
	type VioletTreeRecordsV1,
	type VioletTreeSeedV1,
} from './content.js';
import {
	buildFromRecords,
	buildFromSeed,
	cloneDatabase,
	extractRecords,
	MAX_LOCAL_CONSTRAINTS,
	mergeConstraintsById,
} from './records.js';
import { byCodePoint, orderNodesPreOrder } from './results.js';
import { rewriteVioletError } from './suggestions.js';

export type {
	AuditEvent,
	Constraint,
	Database,
	Node,
	OperationRecord,
	TokenMetadata,
	TokenValue,
	TreeFile,
	VioletTreeContentV1,
	VioletTreeRecordsV1,
	VioletTreeSeedV1,
};
export { checkCssTokenValue, cloneDatabase, createMemoryDatabase, extractRecords };

let initialized = false;
function ensureWorkerCore(): void {
	if (initialized) return;
	initialized = true;
	try {
		initializeWorkerCore();
	} catch (error) {
		// Another module in the same process may already have registered commands (F15).
		if (!(error instanceof Error) || !error.message.includes('already registered')) {
			initialized = false;
			throw error;
		}
	}
}
ensureWorkerCore();

export interface Engine {
	call<T = unknown>(
		name: string,
		input: unknown,
		options?: { appCommand?: string; otherDocument?: string; tokenType?: string }
	): Promise<CommandResult<T>>;
}

export interface ReadSession {
	db: Database;
	engine: Engine;
	content: VioletTreeContentV1;
}

export interface WriteSession extends ReadSession {
	/** Replace the active database (used by `violet-tree-import`) and control `syncedRev` update. */
	replaceDatabase(nextDb: Database, options: { syncRev: boolean }): void;
}

class RollbackSentinel<T> {
	constructor(readonly result: CommandResult<T>) {}
}

function actorOf(context: AppCallContextV1): string {
	return context.actor?.id ?? 'local';
}

function requireReadGrants(context: AppCallContextV1): CommandResult<never> | null {
	if (!context.store) {
		return failure({
			code: 'APP_GRANT_MISSING',
			message: 'Violet needs the `store` grant to read token trees',
			suggestion: 'Declare the `store` grant in loam-app.toml',
		});
	}
	return null;
}

function requireWriteGrants(context: AppCallContextV1): CommandResult<never> | null {
	if (!context.store) {
		return failure({
			code: 'APP_GRANT_MISSING',
			message: 'Violet needs the `store` grant to write token trees',
			suggestion: 'Declare the `store` grant in loam-app.toml',
		});
	}
	if (!context.now) {
		return failure({
			code: 'APP_GRANT_MISSING',
			message: 'Violet needs the `clock` grant so replayed writes record the same timestamps',
			suggestion: 'Declare the `clock` grant in loam-app.toml',
		});
	}
	if (!context.random) {
		return failure({
			code: 'APP_GRANT_MISSING',
			message: 'Violet needs the `random` grant so replayed writes draw the same record ids',
			suggestion: 'Declare the `random` grant in loam-app.toml',
		});
	}
	return null;
}

function createEngine(db: Database, context: AppCallContextV1, defaultAppCommand: string): Engine {
	return {
		async call<T>(
			name: string,
			input: unknown,
			options?: { appCommand?: string; otherDocument?: string; tokenType?: string }
		): Promise<CommandResult<T>> {
			const violetContext: VioletCommandContext = {
				db,
				actor: actorOf(context),
				traceId: context.traceId,
				...(context.now ? { now: context.now } : {}),
				...(context.random ? { random: context.random } : {}),
			};
			const raw = await registry.execute<unknown, T>(name, input, violetContext);
			if (!raw.success) {
				const err = raw.error ?? {
					code: 'INTERNAL_ERROR',
					message: `Violet command '${name}' failed`,
				};
				return failure(
					rewriteVioletError(
						{
							code: err.code,
							message: err.message,
							suggestion: err.suggestion,
							retryable: err.retryable,
							details: err.details as Record<string, unknown> | undefined,
						},
						{
							appCommand: options?.appCommand ?? defaultAppCommand,
							violetCommand: name,
							otherDocument: options?.otherDocument,
							tokenType: options?.tokenType,
							warnings: raw.warnings,
						}
					)
				);
			}
			// Drop Violet's wall-clock metadata, reasoning, sources, and confidence for deterministic replay (F11, §5.6).
			return success(raw.data as T);
		},
	};
}

export interface VioletPort {
	read<T>(
		document: string,
		context: AppCallContextV1,
		appCommand: string,
		run: (session: ReadSession) => Promise<CommandResult<T>>,
		options?: { requireMutationGrants?: boolean }
	): Promise<CommandResult<T>>;
	write<T>(
		document: string,
		context: AppCallContextV1,
		appCommand: string,
		run: (session: WriteSession) => Promise<CommandResult<T>>
	): Promise<CommandResult<T>>;
	importFiles(
		files: readonly TreeFile[],
		constraints: Record<string, Constraint[]>,
		context: AppCallContextV1,
		options?: { baseDb?: Database }
	): Promise<
		CommandResult<{
			db: Database;
			nodes: Array<{ id: string; parent: string | null; tokens: number }>;
		}>
	>;
	clearCache(): void;
}

export function createVioletPort(): VioletPort {
	const cache = new Map<string, { digest: string; db: Database }>();
	const queues = new Map<string, Promise<void>>();

	async function serialize<T>(document: string, fn: () => Promise<T>): Promise<T> {
		const prior = queues.get(document) ?? Promise.resolve();
		let release!: () => void;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const next = prior.then(() => current);
		queues.set(document, next);
		await prior;
		try {
			return await fn();
		} finally {
			release();
			if (queues.get(document) === next) {
				queues.delete(document);
			}
		}
	}

	async function loadDatabase(
		document: string,
		context: AppCallContextV1
	): Promise<CommandResult<{ db: Database; content: VioletTreeContentV1 }>> {
		const raw = await context.store?.get(documentContentKey(document));
		const parsed = parseStoredContent(raw);
		if (!parsed.ok) {
			return failure({
				code: parsed.code,
				message: parsed.message,
				suggestion: parsed.suggestion,
			});
		}
		const { content, json } = parsed;
		if (content.seed) {
			// Seeds are never cached (spec §5.2).
			cache.delete(document);
			const built = await buildFromSeed(document, content.seed, context);
			if (!built.success || !built.data) return built as CommandResult<never>;
			return success({ db: built.data, content });
		}
		const digest = await contentDigest(json);
		const cached = cache.get(document);
		if (cached && cached.digest === digest) {
			return success({ db: cached.db, content });
		}
		const db = await buildFromRecords(content.records as VioletTreeRecordsV1);
		cache.set(document, { digest, db });
		return success({ db, content });
	}

	return {
		async read<T>(
			document: string,
			context: AppCallContextV1,
			appCommand: string,
			run: (session: ReadSession) => Promise<CommandResult<T>>,
			options?: { requireMutationGrants?: boolean }
		): Promise<CommandResult<T>> {
			const missing = options?.requireMutationGrants
				? requireWriteGrants(context)
				: requireReadGrants(context);
			if (missing) return missing;
			return serialize(document, async () => {
				const loaded = await loadDatabase(document, context);
				if (!loaded.success || !loaded.data) return loaded as CommandResult<never>;
				const { db, content } = loaded.data;
				return run({ db, engine: createEngine(db, context, appCommand), content });
			});
		},

		async write<T>(
			document: string,
			context: AppCallContextV1,
			appCommand: string,
			run: (session: WriteSession) => Promise<CommandResult<T>>
		): Promise<CommandResult<T>> {
			const missing = requireWriteGrants(context);
			if (missing) return missing;
			return serialize(document, async () => {
				const loaded = await loadDatabase(document, context);
				if (!loaded.success || !loaded.data) return loaded as CommandResult<never>;
				const { db, content } = loaded.data;
				let activeDb = db;
				let syncRev = false;
				const engine = createEngine(db, context, appCommand);

				let result: CommandResult<T>;
				try {
					result = await db.transaction(async () => {
						const res = await run({
							db,
							engine,
							content,
							replaceDatabase(nextDb, options) {
								activeDb = nextDb;
								syncRev = options.syncRev;
							},
						});
						if (!res.success) {
							throw new RollbackSentinel(res);
						}
						return res;
					});
				} catch (caught) {
					cache.delete(document);
					if (caught instanceof RollbackSentinel) {
						return caught.result as CommandResult<T>;
					}
					throw caught;
				}

				const records = await extractRecords(activeDb);
				const nextRev = content.rev + 1;
				const nextSyncedRev = syncRev ? nextRev : content.syncedRev;
				const nextContent: VioletTreeContentV1 = {
					format: 'violet-tree',
					version: 1,
					rev: nextRev,
					syncedRev: nextSyncedRev,
					records,
				};
				const nextJson = JSON.stringify(nextContent);
				try {
					await context.store?.put(documentContentKey(document), nextContent);
				} catch (error) {
					// Refused store.put (e.g. QUOTA_EXCEEDED) drops the cache entry so reads see stored state (spec §5.2).
					cache.delete(document);
					throw error;
				}
				const nextDigest = await contentDigest(nextJson);
				cache.set(document, { digest: nextDigest, db: activeDb });
				return result;
			});
		},

		async importFiles(
			files: readonly TreeFile[],
			constraints: Record<string, Constraint[]>,
			context: AppCallContextV1,
			options?: { baseDb?: Database }
		) {
			const missing = requireWriteGrants(context);
			if (missing) return missing;
			const deletedIds = new Set(
				options?.baseDb
					? (await options.baseDb.listNodes())
							.filter((node) => Boolean(node.deletedAt))
							.map((node) => node.id)
					: []
			);
			const targetDb = options?.baseDb
				? await cloneDatabase(options.baseDb)
				: createMemoryDatabase();

			if (files.length === 0) {
				for (const [nodeId, list] of Object.entries(constraints)) {
					const merged = mergeConstraintsById(await targetDb.getConstraints(nodeId), list);
					if (merged.length > MAX_LOCAL_CONSTRAINTS) {
						return failure({
							code: 'VALIDATION_ERROR',
							message: `Node '${nodeId}' has ${merged.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
							suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node before importing with violet-tree-import`,
						});
					}
					if (merged.length > 0) await targetDb.setConstraints(nodeId, merged);
				}
				return success({ db: targetDb, nodes: [] });
			}

			const engine = createEngine(targetDb, context, 'violet-tree-import');
			const res = await engine.call<{
				nodes: Array<{ id: string; parentId?: string | null; tokensImported: number }>;
			}>('import.tree', { files }, { appCommand: 'violet-tree-import' });
			if (!res.success || !res.data) {
				return res as CommandResult<never>;
			}
			for (const [nodeId, list] of Object.entries(constraints)) {
				const merged = mergeConstraintsById(await targetDb.getConstraints(nodeId), list);
				if (merged.length > MAX_LOCAL_CONSTRAINTS) {
					return failure({
						code: 'VALIDATION_ERROR',
						message: `Node '${nodeId}' has ${merged.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
						suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node before importing with violet-tree-import`,
					});
				}
				if (merged.length > 0) await targetDb.setConstraints(nodeId, merged);
			}
			// Verify no imported node id contains '#', no imported node targets a soft-deleted parent,
			// and every imported node stays within Loam's 50-rule local constraint limit (spec §4.4, §5.7, §6.5).
			const importedNodes: Array<{ id: string; parent: string | null; tokens: number }> = [];
			for (const entry of res.data.nodes) {
				if (entry.id.includes('#')) {
					return failure({
						code: 'VALIDATION_ERROR',
						message: `Node id '${entry.id}' cannot contain '#'`,
						suggestion: "Remove '#' from the node id in its token file before importing",
					});
				}
				const localRules = await targetDb.getConstraints(entry.id);
				if (localRules.length > MAX_LOCAL_CONSTRAINTS) {
					return failure({
						code: 'VALIDATION_ERROR',
						message: `Node '${entry.id}' defines ${localRules.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
						suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node in its token file before importing with violet-tree-import`,
					});
				}
				const stored = await targetDb.getNode(entry.id);
				const parent = stored?.parentId ?? entry.parentId ?? null;
				if (parent && deletedIds.has(parent)) {
					return failure({
						code: 'INVALID_PARENT',
						message: `Parent node '${parent}' has been deleted`,
						suggestion: 'Use violet-node-list to pick an active parent node id before importing',
					});
				}
				importedNodes.push({ id: entry.id, parent, tokens: entry.tokensImported });
			}
			const ordered = orderNodesPreOrder(await targetDb.listNodes());
			const rank = new Map(ordered.map((node, index) => [node.id, index]));
			importedNodes.sort((a, b) => {
				const ra = rank.get(a.id);
				const rb = rank.get(b.id);
				if (ra !== undefined && rb !== undefined) return ra - rb;
				if (ra !== undefined) return -1;
				if (rb !== undefined) return 1;
				return byCodePoint(a.id, b.id);
			});
			return success({ db: targetDb, nodes: importedNodes });
		},

		clearCache(): void {
			cache.clear();
		},
	};
}

export const defaultPort = createVioletPort();

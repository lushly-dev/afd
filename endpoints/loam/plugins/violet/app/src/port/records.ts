/**
 * @fileoverview Database hydration, seed building, snapshot extraction, and cloning helpers (spec §5.2–§5.5).
 */
import { type AppCallContextV1, type CommandResult, failure, success } from '@lushly-dev/loam-sdk';
import {
	createMemoryDatabase,
	type Database,
	registry,
	type CommandContext as VioletCommandContext,
} from '@lushly-dev/violet-afd/worker';
import type { Constraint, OperationRecord } from '@lushly-dev/violet-core/types';
import { seededRandom, type VioletTreeRecordsV1, type VioletTreeSeedV1 } from './content.js';
import { rewriteVioletError } from './suggestions.js';

/** Maximum local constraints allowed per node in Loam (matches `violet-constraint-set` schema `maxItems: 50`). */
export const MAX_LOCAL_CONSTRAINTS = 50;

/** Merge two local constraint lists by rule `id`; `overlay` overrides matching IDs and appends new ones. */
export function mergeConstraintsById(
	base: readonly Constraint[],
	overlay: readonly Constraint[]
): Constraint[] {
	const byId = new Map<string, Constraint>();
	for (const rule of base) byId.set(rule.id, structuredClone(rule));
	for (const rule of overlay) byId.set(rule.id, structuredClone(rule));
	return [...byId.values()];
}

/** Populate a fresh `MemoryDatabase` from stored `records` without drawing clock or random (spec §5.2). */
export async function buildFromRecords(records: VioletTreeRecordsV1): Promise<Database> {
	const db = createMemoryDatabase();
	for (const node of records.nodes) {
		await db.createNode({ ...node });
	}
	for (const op of records.operations) {
		await db.addOperation({ ...op });
	}
	for (const [nodeId, list] of Object.entries(records.constraints)) {
		if (list.length > 0) {
			await db.setConstraints(nodeId, structuredClone(list));
		}
	}
	for (const event of records.audit) {
		await db.addAuditEvent({ ...event });
	}
	return db;
}

/**
 * Populate a fresh `MemoryDatabase` from a template `seed` (spec §5.2, F17).
 * Never draws from `context.random()` so query and mutation builds produce identical ids.
 */
export async function buildFromSeed(
	document: string,
	seed: VioletTreeSeedV1,
	context: AppCallContextV1
): Promise<CommandResult<Database>> {
	if (seed.files.length === 0) {
		const empty = createMemoryDatabase();
		if (seed.constraints) {
			for (const [nodeId, list] of Object.entries(seed.constraints)) {
				if (list.length > MAX_LOCAL_CONSTRAINTS) {
					return failure({
						code: 'VALIDATION_ERROR',
						message: `Node '${nodeId}' has ${list.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
						suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node in seed files or templates`,
					});
				}
				if (list.length > 0) await empty.setConstraints(nodeId, structuredClone(list));
			}
		}
		return success(empty);
	}

	const scratch = createMemoryDatabase();
	const fixedTime = context.now ? context.now() : 0;
	const scratchContext: VioletCommandContext = {
		db: scratch,
		actor: 'seed',
		traceId: context.traceId,
		now: () => fixedTime,
		random: seededRandom(document),
	};
	const imported = await registry.execute('import.tree', { files: seed.files }, scratchContext);
	if (!imported.success) {
		const err = imported.error ?? { code: 'INTERNAL_ERROR', message: 'Seed import failed' };
		return failure(
			rewriteVioletError(err, {
				appCommand: 'violet-tree-import',
				violetCommand: 'import.tree',
				warnings: imported.warnings,
			})
		);
	}

	// Copy nodes, operations, and file-embedded constraints into a clean database with zero audit events (spec §5.2).
	const clean = createMemoryDatabase();
	const nodes = await scratch.listNodes();
	const seedConstraints = seed.constraints ?? {};
	const handledConstraintNodes = new Set<string>();
	for (const node of nodes) {
		await clean.createNode({ ...node });
		const ops = await scratch.getOperations(node.id);
		for (const op of ops) {
			await clean.addOperation({ ...op });
		}
		const fileRules = await scratch.getConstraints(node.id);
		const overlayRules = Object.hasOwn(seedConstraints, node.id)
			? (seedConstraints[node.id] ?? [])
			: [];
		handledConstraintNodes.add(node.id);
		const merged = mergeConstraintsById(fileRules, overlayRules);
		if (merged.length > MAX_LOCAL_CONSTRAINTS) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: `Node '${node.id}' has ${merged.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
				suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node in seed files or templates`,
			});
		}
		if (merged.length > 0) {
			await clean.setConstraints(node.id, merged);
		}
	}
	for (const [nodeId, list] of Object.entries(seedConstraints)) {
		if (handledConstraintNodes.has(nodeId)) continue;
		if (list.length > MAX_LOCAL_CONSTRAINTS) {
			return failure({
				code: 'VALIDATION_ERROR',
				message: `Node '${nodeId}' has ${list.length} local constraints, over the ${MAX_LOCAL_CONSTRAINTS}-rule limit`,
				suggestion: `Keep at most ${MAX_LOCAL_CONSTRAINTS} local rules per node in seed files or templates`,
			});
		}
		if (list.length > 0) await clean.setConstraints(nodeId, structuredClone(list));
	}
	return success(clean);
}

/** Snapshot all nodes (including soft-deleted), operations, constraints, and audit events (spec §5.3). */
export async function extractRecords(db: Database): Promise<VioletTreeRecordsV1> {
	const nodes = await db.listNodes();
	const operations: OperationRecord[] = [];
	const constraintEntries: Array<[string, Constraint[]]> = [];
	for (const node of nodes) {
		const ops = await db.getOperations(node.id);
		for (const op of ops) operations.push(structuredClone(op));
		const rules = await db.getConstraints(node.id);
		if (rules.length > 0) constraintEntries.push([node.id, structuredClone(rules)]);
	}
	const newestFirstEvents = await db.getAuditEvents({});
	const audit = [...newestFirstEvents].reverse().map((event) => structuredClone(event));
	return {
		nodes: nodes.map((node) => structuredClone(node)),
		operations,
		constraints: Object.fromEntries(constraintEntries),
		audit,
	};
}

/** Copy all records from an existing database into a fresh `MemoryDatabase` for atomic additive import (spec §5.5). */
export async function cloneDatabase(db: Database): Promise<Database> {
	return buildFromRecords(await extractRecords(db));
}

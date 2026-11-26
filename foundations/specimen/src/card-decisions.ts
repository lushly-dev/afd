/**
 * Card-mode execution for `decision-record` (Agent-First Design Phase C2, #2562).
 * Handles single `card` and non-regression batch `cards`, lasting `refusalScope: 'unsafe'`
 * blocking (closing re-proposed cards as `rejected`), separate `regressionAccepted` checks,
 * `supersedes` + `remediation`, card-digest pinning (`STALE_CARD`), terminal status guards,
 * and atomic/transactional pattern fork/merge application with fail-closed `UPSTREAM_CHANGED`.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CardChosen, CardPatternAction, CardStatus, DesignCardRecord } from './card-types.js';
import { cardFilePath, computeCardDigest, readCardRecord, writeCardRecord } from './cards.js';
import {
	allocateDecisionId,
	decisionFilePath,
	formatSingleCardResult,
	readAllDecisions,
	supersededIdsFromRecords,
	typedError,
	writeDecisionFile,
} from './decisions-store.js';
import { getDefaultPatternsPackDir } from './defaults.js';
import { canonicalJson, packDigest } from './pack.js';
import { PACK_PATTERNS } from './pack-atoms.js';
import { BUILTIN_DEFAULTS_UPSTREAM_PREFIX, extractCardUpstreamDigests } from './pattern-fork.js';
import { DEFAULT_PATTERNS_DIRECTORY, resolvePatternSource } from './patterns.js';
import { assertRealContained, assertRealFileContained, writeFileAtomic } from './sets.js';
import type {
	CardDecisionRecord,
	DecisionActor,
	DecisionRecordRequest,
	DecisionRecordResult,
	DecisionRecordSingleResult,
	RecordDecisionOptions,
} from './types.js';
import { parseConfig } from './validate.js';

const DECIDABLE_CARD_STATUSES: ReadonlySet<CardStatus> = new Set([
	'open',
	'changes-requested',
	'deferred',
	'provisional',
]);

function cardStatusForChosen(chosen: CardChosen): CardStatus {
	switch (chosen) {
		case 'approve':
			return 'approved';
		case 'request-changes':
			return 'changes-requested';
		case 'reject':
			return 'rejected';
		case 'defer':
			return 'deferred';
	}
}

export function effectiveChangeSignature(card: DesignCardRecord): string {
	if (card.changeSignature) return card.changeSignature;
	const sortedTouches = [...card.touches].sort();
	return createHash('sha256')
		.update(JSON.stringify({ what: card.what.trim().toLowerCase(), touches: sortedTouches }))
		.digest('hex');
}

async function readSiblingLibraryVersion(
	baseDir: string,
	upstreamAbs: string
): Promise<string | undefined> {
	// Pack Format 2 pattern files live at `data/<library>/patterns/<pattern>.json`; catalog is `../library.json`.
	const catalogFile = join(dirname(dirname(upstreamAbs)), 'library.json');
	try {
		await assertRealFileContained(
			baseDir,
			catalogFile,
			`Upstream catalog escapes authorized pack root: ${catalogFile}`
		);
		const raw = JSON.parse(await readFile(catalogFile, 'utf8')) as {
			package?: { version?: unknown };
		};
		return typeof raw.package?.version === 'string' ? raw.package.version : undefined;
	} catch {
		return undefined;
	}
}

async function resolveConfiguredPatternSourceRoots(
	root: string,
	configPath?: string
): Promise<string[]> {
	const configRel = configPath ?? 'specimen.config.json';
	const configAbs = resolve(root, configRel);
	if (!existsSync(configAbs)) return [];
	try {
		await assertRealFileContained(
			root,
			configAbs,
			`Config path escapes workspace root: ${configRel}`
		);
		const raw = JSON.parse(await readFile(configAbs, 'utf8')) as {
			patternSources?: unknown;
		};
		if (!Array.isArray(raw.patternSources)) return [];
		const roots: string[] = [];
		for (const source of raw.patternSources) {
			if (typeof source !== 'string' || !source.trim()) continue;
			try {
				roots.push(await resolvePatternSource(configAbs, source));
			} catch {
				// Skip unresolvable source entries; remaining sources may still match.
			}
		}
		return roots;
	} catch {
		return [];
	}
}

async function resolveCardUpstreamAbs(
	root: string,
	upstreamPath: string,
	configPath?: string
): Promise<{ upstreamAbs: string; baseDir: string }> {
	if (upstreamPath.startsWith(BUILTIN_DEFAULTS_UPSTREAM_PREFIX)) {
		const patternName = upstreamPath.slice(BUILTIN_DEFAULTS_UPSTREAM_PREFIX.length);
		if (!PACK_PATTERNS.pattern.test(patternName) || patternName.length > 64) {
			throw typedError(
				'UPSTREAM_CHANGED',
				`Invalid builtin defaults upstream path '${upstreamPath}'.`,
				'Re-run specimen-pattern-compare and specimen-pattern-merge to stage a verifiable merge card.'
			);
		}
		const packDir = getDefaultPatternsPackDir();
		const upstreamAbs = join(packDir, 'data', 'afd-defaults', 'patterns', `${patternName}.json`);
		await assertRealFileContained(
			packDir,
			upstreamAbs,
			`Builtin upstream pattern file escapes defaults pack: ${upstreamPath}`
		);
		return { upstreamAbs, baseDir: packDir };
	}

	const upstreamAbs = isAbsolute(upstreamPath)
		? resolve(upstreamPath)
		: resolve(root, upstreamPath);

	// 1. Check containment inside workspace root first (covers local/relative upstream packs).
	try {
		await assertRealFileContained(
			root,
			upstreamAbs,
			`Upstream pattern file escapes workspace root: ${upstreamPath}`
		);
		return { upstreamAbs, baseDir: root };
	} catch (workspaceErr) {
		// 2. Also authorize configured external patternSources packs (e.g. installed npm packages or sibling packs).
		const sourceRoots = await resolveConfiguredPatternSourceRoots(root, configPath);
		for (const packRoot of sourceRoots) {
			try {
				await assertRealFileContained(
					packRoot,
					upstreamAbs,
					`Upstream pattern file escapes pattern source pack: ${upstreamPath}`
				);
				return { upstreamAbs, baseDir: packRoot };
			} catch {
				// Try next configured source root.
			}
		}
		throw workspaceErr;
	}
}

async function readJsonFileStrict(
	absPath: string,
	label: string,
	suggestion: string
): Promise<{ rawText: string; data: Record<string, unknown> }> {
	let rawText: string;
	try {
		rawText = await readFile(absPath, 'utf8');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		throw typedError(
			'VALIDATION_ERROR',
			`${label} could not be read (${code ?? 'IO_ERROR'}).`,
			suggestion
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw typedError('VALIDATION_ERROR', `${label} contains invalid JSON.`, suggestion);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw typedError('VALIDATION_ERROR', `${label} must be a JSON object.`, suggestion);
	}
	return { rawText, data: parsed as Record<string, unknown> };
}

interface PlannedFileWrite {
	absPath: string;
	content: string;
	originalContent: string | null;
}

interface PreparedPatternAction {
	writes: PlannedFileWrite[];
	appliedPatterns: string[];
	patternDigests: Record<string, string>;
}

async function preparePatternAction(
	root: string,
	action: CardPatternAction,
	cardId: string
): Promise<PreparedPatternAction> {
	const configBaseDir = action.configPath
		? dirname(resolve(root, action.configPath))
		: resolve(root);
	const patternsRoot = join(configBaseDir, DEFAULT_PATTERNS_DIRECTORY);
	const patternAbs = resolve(root, action.patternPath);
	await assertRealContained(
		root,
		patternsRoot,
		`Patterns root escapes workspace root: ${DEFAULT_PATTERNS_DIRECTORY}`
	);
	await assertRealContained(
		root,
		patternAbs,
		`Pattern path escapes workspace root: ${action.patternPath}`
	);
	await assertRealContained(
		patternsRoot,
		patternAbs,
		`Pattern path must reside under ${DEFAULT_PATTERNS_DIRECTORY}/: ${action.patternPath}`
	);

	const writes: PlannedFileWrite[] = [];

	if (action.kind === 'fork') {
		await assertRealFileContained(
			patternsRoot,
			patternAbs,
			`Forked pattern file escapes ${DEFAULT_PATTERNS_DIRECTORY}/: ${action.patternPath}`
		);
		const { rawText: origPatternText, data: raw } = await readJsonFileStrict(
			patternAbs,
			`Forked pattern '${action.patternPath}'`,
			'Ensure the proposed forked pattern file exists and contains valid JSON before approving.'
		);
		const updated = {
			...raw,
			approvalStatus: 'approved',
		};
		writes.push({
			absPath: patternAbs,
			content: `${JSON.stringify(updated, null, '\t')}\n`,
			originalContent: origPatternText,
		});

		if (action.bind && action.source) {
			const configRel = action.configPath ?? 'specimen.config.json';
			const configAbs = resolve(root, configRel);
			await assertRealFileContained(
				root,
				configAbs,
				`Config path escapes workspace root: ${configRel}`
			);
			const { rawText: origConfigText, data: configRaw } = await readJsonFileStrict(
				configAbs,
				`Specimen config '${configRel}'`,
				'Ensure specimen.config.json exists and is valid JSON before approving a bound pattern fork.'
			);
			const bindings =
				typeof configRaw.patternBindings === 'object' &&
				configRaw.patternBindings !== null &&
				!Array.isArray(configRaw.patternBindings)
					? { ...(configRaw.patternBindings as Record<string, string>) }
					: {};
			bindings[action.source] = `${action.library}/${action.pattern}`;
			const nextConfig = {
				...configRaw,
				patternBindings: bindings,
			};
			try {
				parseConfig(nextConfig);
			} catch (error) {
				throw typedError(
					'VALIDATION_ERROR',
					`Updating patternBindings in '${configRel}' failed config validation: ${error instanceof Error ? error.message : String(error)}`,
					'Fix specimen.config.json before approving this pattern binding.'
				);
			}
			writes.push({
				absPath: configAbs,
				content: `${JSON.stringify(nextConfig, null, '\t')}\n`,
				originalContent: origConfigText,
			});
		}
		const qualified = `${action.library}/${action.pattern}`;
		return {
			writes,
			appliedPatterns: [qualified],
			patternDigests: { [qualified]: packDigest(canonicalJson(updated)) },
		};
	}

	// Merge action: authoritative upstream staleness verification is REQUIRED (never fail-open).
	if (!action.upstreamPath?.trim()) {
		throw typedError(
			'UPSTREAM_CHANGED',
			`Merge card '${cardId}' is missing authoritative upstreamPath for '${action.upstreamLibrary}/${action.upstreamPattern}'.`,
			'Re-run specimen-pattern-compare and specimen-pattern-merge to stage a verifiable merge card.'
		);
	}
	const { upstreamAbs, baseDir: upstreamBaseDir } = await resolveCardUpstreamAbs(
		root,
		action.upstreamPath,
		action.configPath
	);
	const { data: upstreamRaw } = await readJsonFileStrict(
		upstreamAbs,
		`Upstream pattern '${action.upstreamPath}'`,
		'Re-run specimen-pattern-compare and specimen-pattern-merge against the current upstream pattern.'
	);

	// 1. Verify pinned upstream version when present on live upstream or its Pack Format 2 catalog
	const liveVersion =
		typeof upstreamRaw.version === 'string'
			? upstreamRaw.version
			: await readSiblingLibraryVersion(upstreamBaseDir, upstreamAbs);
	if (liveVersion !== undefined && liveVersion !== action.upstreamVersion) {
		throw typedError(
			'UPSTREAM_CHANGED',
			`Upstream pattern '${action.upstreamLibrary}/${action.upstreamPattern}' moved from version ${action.upstreamVersion} to ${liveVersion}.`,
			'Re-run specimen-pattern-compare and specimen-pattern-merge against the current upstream version before approving.',
			{
				upstream: `${action.upstreamLibrary}/${action.upstreamPattern}`,
				expectedVersion: action.upstreamVersion,
				actualVersion: liveVersion,
				card: cardId,
			}
		);
	}

	// 2. Verify complete statement digests bidirectionally (changed, removed, or newly added statements AND #gate/#setup keys)
	const currentDigests = extractCardUpstreamDigests(upstreamRaw);
	const changedIds: string[] = [];
	for (const [stmtId, pinnedDigest] of Object.entries(action.upstreamDigests)) {
		if (currentDigests[stmtId] !== pinnedDigest) {
			changedIds.push(stmtId);
		}
	}
	for (const liveId of Object.keys(currentDigests)) {
		if (!(liveId in action.upstreamDigests) && !changedIds.includes(liveId)) {
			changedIds.push(liveId);
		}
	}
	if (changedIds.length > 0) {
		throw typedError(
			'UPSTREAM_CHANGED',
			`Upstream pattern '${action.upstreamLibrary}/${action.upstreamPattern}' changed since merge card was staged (${changedIds.join(', ')}).`,
			'Re-run specimen-pattern-compare and specimen-pattern-merge against the current upstream version before approving.',
			{
				upstream: `${action.upstreamLibrary}/${action.upstreamPattern}`,
				upstreamVersion: action.upstreamVersion,
				changedStatements: changedIds,
				card: cardId,
			}
		);
	}

	// 3. Verify target local pattern still exists and has not changed since staging (never lose concurrent local edits).
	if (!existsSync(patternAbs)) {
		throw typedError(
			'STALE_CARD',
			`Local pattern '${action.patternPath}' no longer exists on disk since merge card '${cardId}' was staged.`,
			'Restore the local pattern or re-run specimen-pattern-compare and specimen-pattern-merge.',
			{ card: cardId, patternPath: action.patternPath }
		);
	}
	await assertRealFileContained(
		patternsRoot,
		patternAbs,
		`Target pattern file escapes ${DEFAULT_PATTERNS_DIRECTORY}/: ${action.patternPath}`
	);
	const { rawText: origTargetContent, data: liveLocalRaw } = await readJsonFileStrict(
		patternAbs,
		`Target pattern '${action.patternPath}'`,
		'Fix JSON syntax in the local pattern file and re-run specimen-pattern-merge before approving.'
	);
	if (action.localDigest !== undefined) {
		const liveLocalDigest = packDigest(canonicalJson(liveLocalRaw));
		if (liveLocalDigest !== action.localDigest) {
			throw typedError(
				'STALE_CARD',
				`Local pattern '${action.patternPath}' was modified after merge card '${cardId}' was staged.`,
				'Re-run specimen-pattern-compare and specimen-pattern-merge to incorporate intervening local edits before approving.',
				{
					card: cardId,
					patternPath: action.patternPath,
					expectedLocalDigest: action.localDigest,
					actualLocalDigest: liveLocalDigest,
				}
			);
		}
	}

	const mergedPattern = {
		...action.stagedPattern,
		approvalStatus: 'approved',
	};
	writes.push({
		absPath: patternAbs,
		content: `${JSON.stringify(mergedPattern, null, '\t')}\n`,
		originalContent: origTargetContent,
	});
	const qualified = `${action.library}/${action.pattern}`;
	return {
		writes,
		appliedPatterns: [qualified],
		patternDigests: { [qualified]: packDigest(canonicalJson(mergedPattern)) },
	};
}

async function prepareForkRejectionCleanup(
	root: string,
	action: CardPatternAction
): Promise<PreparedPatternAction | undefined> {
	if (action.kind !== 'fork' || !action.bind || !action.source) return undefined;
	const configRel = action.configPath ?? 'specimen.config.json';
	const configAbs = resolve(root, configRel);
	if (!existsSync(configAbs)) return undefined;
	await assertRealFileContained(
		root,
		configAbs,
		`Config path escapes workspace root: ${configRel}`
	);
	const { rawText: origConfigText, data: configRaw } = await readJsonFileStrict(
		configAbs,
		`Specimen config '${configRel}'`,
		'Ensure specimen.config.json is valid JSON before rejecting a bound pattern fork.'
	);
	if (
		typeof configRaw.patternBindings !== 'object' ||
		configRaw.patternBindings === null ||
		Array.isArray(configRaw.patternBindings)
	) {
		return undefined;
	}
	const bindings = { ...(configRaw.patternBindings as Record<string, string>) };
	const expectedTarget = `${action.library}/${action.pattern}`;
	if (bindings[action.source] !== expectedTarget) return undefined;
	delete bindings[action.source];
	const nextConfig = { ...configRaw };
	if (Object.keys(bindings).length > 0) {
		nextConfig.patternBindings = bindings;
	} else {
		delete nextConfig.patternBindings;
	}
	try {
		parseConfig(nextConfig);
	} catch (error) {
		throw typedError(
			'VALIDATION_ERROR',
			`Removing pending binding from '${configRel}' failed config validation: ${error instanceof Error ? error.message : String(error)}`,
			'Fix specimen.config.json before rejecting this pattern binding.'
		);
	}
	return {
		writes: [
			{
				absPath: configAbs,
				content: `${JSON.stringify(nextConfig, null, '\t')}\n`,
				originalContent: origConfigText,
			},
		],
		appliedPatterns: [],
		patternDigests: {},
	};
}

export async function recordCardDecision(
	root: string,
	request: DecisionRecordRequest,
	trimmedReason: string,
	decidedAt: string,
	options: RecordDecisionOptions
): Promise<DecisionRecordResult> {
	// Card mode NEVER permits provisional panel decisions or non-person actors
	const invokingKind = options.invokingActorKind ?? options.decidedBy?.kind ?? 'script';
	const isPersonAuthorized =
		options.humanConfirmed === true || invokingKind === 'person' || invokingKind === 'test';
	if (request.provisional === true || !isPersonAuthorized) {
		throw typedError(
			'PERSON_REQUIRED',
			'Deciding a release, guidance, or escalated card requires a host-verified person.',
			'Stop retrying as an agent or panel; hand the card to a person for decision.'
		);
	}

	const chosen = request.chosen as CardChosen;
	const targetCardIds = (request.cards ?? [request.card as string]).map((id) => id.trim());
	const isBatch = request.cards !== undefined;

	// Phase 1: Preflight ALL cards & validations before ANY disk writes
	const cards: DesignCardRecord[] = [];
	const origCardTexts = new Map<string, string | null>();
	for (const cardId of targetCardIds) {
		const card = await readCardRecord(root, cardId);
		if (!DECIDABLE_CARD_STATUSES.has(card.status)) {
			throw typedError(
				'CARD_ALREADY_DECIDED',
				`Decision card '${card.card}' is in terminal status '${card.status}' and cannot be decided again.`,
				'Inspect design-card-list for active open, deferred, or changes-requested cards.',
				{ card: card.card, status: card.status }
			);
		}
		if (options.expectedCardDigests !== undefined) {
			const expected = options.expectedCardDigests[card.card];
			const actual = computeCardDigest(card);
			if (!expected || expected !== actual) {
				throw typedError(
					'STALE_CARD',
					`Decision card '${card.card}' changed after confirmation was requested.`,
					'Review the updated card in design-card-list and confirm again.',
					{ card: card.card, expectedDigest: expected, actualDigest: actual }
				);
			}
		}
		origCardTexts.set(
			card.card,
			await readFile(cardFilePath(root, card.card), 'utf8').catch(() => null)
		);
		cards.push(card);
	}

	if (isBatch) {
		const regressionCard = cards.find((c) => c.effect.regression);
		if (regressionCard) {
			throw typedError(
				'REGRESSION_ACK_REQUIRED',
				`Batch card decision refused: card '${regressionCard.card}' has a gate regression and must be decided individually with regressionAccepted: true.`,
				'Decide regression cards one at a time with card and regressionAccepted: true.',
				{ card: regressionCard.card }
			);
		}
	}

	if (chosen === 'reject' && request.refusalScope === undefined) {
		throw typedError(
			'REFUSAL_SCOPE_REQUIRED',
			'Rejecting a card requires refusalScope (unsafe, wrong-for-context, or not-a-priority).',
			'Pass refusalScope ("unsafe", "wrong-for-context", or "not-a-priority") when rejecting a card.'
		);
	}
	if (chosen !== 'reject' && request.refusalScope !== undefined) {
		throw typedError(
			'VALIDATION_ERROR',
			'refusalScope is only valid when chosen is "reject".',
			'Remove refusalScope unless recording chosen: "reject".'
		);
	}
	if (chosen !== 'approve' && request.regressionAccepted !== undefined) {
		throw typedError(
			'VALIDATION_ERROR',
			'regressionAccepted is only valid when chosen is "approve".',
			'Remove regressionAccepted unless recording chosen: "approve".'
		);
	}

	const allDecisions = await readAllDecisions(root);
	const supersededIds = supersededIdsFromRecords(allDecisions);
	const activeUnsafeRefusals = allDecisions.filter(
		(rec): rec is CardDecisionRecord =>
			rec.kind === 'card' &&
			rec.chosen === 'reject' &&
			rec.refusalScope === 'unsafe' &&
			!supersededIds.has(rec.id)
	);

	// Validate supersedes target if provided
	const supersedesId =
		typeof request.supersedes === 'string' ? request.supersedes.trim() : undefined;
	const trimmedRemediation = request.remediation?.trim();
	if (supersedesId !== undefined) {
		const targetDecision = allDecisions.find((rec) => rec.id === supersedesId);
		if (!targetDecision) {
			throw typedError(
				'DECISION_NOT_FOUND',
				`Decision not found: ${supersedesId}`,
				'Use decision-list to see current decision ids.',
				{ decision: supersedesId }
			);
		}
		if (
			targetDecision.kind === 'card' &&
			targetDecision.chosen === 'reject' &&
			targetDecision.refusalScope === 'unsafe' &&
			!trimmedRemediation
		) {
			throw typedError(
				'REFUSED_AS_UNSAFE',
				`Superseding safety refusal '${supersedesId}' requires a remediation explanation.`,
				'Provide both supersedes and remediation explaining how the safety concern was fixed.',
				{ decision: supersedesId }
			);
		}
	}

	// Preflight unsafe refusals, regressions, and pattern actions across ALL cards BEFORE writing any decision
	const preparedActions = new Map<string, PreparedPatternAction>();
	for (const card of cards) {
		const sig = effectiveChangeSignature(card);
		if (chosen === 'approve') {
			const blocking = activeUnsafeRefusals.find((refusal) => refusal.changeSignature === sig);
			if (blocking && !(supersedesId === blocking.id && trimmedRemediation)) {
				// Close the re-proposed card as 'rejected' so it never strands the release gate
				await writeCardRecord(root, { ...card, status: 'rejected' });
				throw typedError(
					'REFUSED_AS_UNSAFE',
					`Card '${card.card}' re-proposes a change previously refused as unsafe by decision '${blocking.id}' (${blocking.reason}).`,
					`Read safety decision '${blocking.id}' in decision-list and pass supersedes: '${blocking.id}' with remediation once fixed.`,
					{ card: card.card, decision: blocking.id, reason: blocking.reason }
				);
			}
			if (card.effect.regression && request.regressionAccepted !== true) {
				throw typedError(
					'REGRESSION_ACK_REQUIRED',
					`Card '${card.card}' introduces a gate regression and requires explicit regressionAccepted: true.`,
					'Pass regressionAccepted: true separately when approving a card whose effect.regression is true.',
					{ card: card.card }
				);
			}
			if (card.patternAction) {
				preparedActions.set(
					card.card,
					await preparePatternAction(root, card.patternAction, card.card)
				);
			}
		} else if (chosen === 'reject' && card.patternAction) {
			const cleanup = await prepareForkRejectionCleanup(root, card.patternAction);
			if (cleanup) {
				preparedActions.set(card.card, cleanup);
			}
		}
	}

	const decidedBy: DecisionActor = options.decidedBy ?? {
		kind: invokingKind === 'test' && !options.humanConfirmed ? 'test' : 'person',
		...(options.actorId ? { id: options.actorId } : {}),
		...(options.humanConfirmed ? { channel: 'mcp-relay' } : {}),
	};
	const trimmedMeantToFix = request.meantToFix
		? { job: request.meantToFix.job.trim(), target: request.meantToFix.target.trim() }
		: undefined;

	// Phase 2: Transactional commit with rollback on any mid-way failure
	const results: DecisionRecordSingleResult[] = [];
	const reserved = new Set<string>();
	const writtenBackups = new Map<string, string | null>();
	const createdDecisionPaths: string[] = [];

	try {
		for (const card of cards) {
			const sig = effectiveChangeSignature(card);
			const id = await allocateDecisionId(root, reserved);
			reserved.add(id);

			const prepared = preparedActions.get(card.card);
			if (prepared) {
				for (const planned of prepared.writes) {
					if (!writtenBackups.has(planned.absPath)) {
						writtenBackups.set(planned.absPath, planned.originalContent);
					}
					await writeFileAtomic(planned.absPath, planned.content);
				}
			}

			const appliedPatterns = prepared?.appliedPatterns;
			const patternDigests = prepared?.patternDigests;
			const record: CardDecisionRecord = {
				id,
				kind: 'card',
				card: card.card,
				question: card.what,
				chosen,
				reason: trimmedReason,
				...(request.refusalScope !== undefined ? { refusalScope: request.refusalScope } : {}),
				...(request.regressionAccepted !== undefined
					? { regressionAccepted: request.regressionAccepted }
					: {}),
				...(trimmedMeantToFix !== undefined ? { meantToFix: trimmedMeantToFix } : {}),
				...(supersedesId !== undefined ? { supersedes: supersedesId } : {}),
				...(trimmedRemediation !== undefined ? { remediation: trimmedRemediation } : {}),
				changeSignature: sig,
				...(appliedPatterns !== undefined && appliedPatterns.length > 0 ? { appliedPatterns } : {}),
				...(patternDigests !== undefined && Object.keys(patternDigests).length > 0
					? { patternDigests }
					: {}),
				decidedAt,
				decidedBy,
			};

			const relPath = await writeDecisionFile(root, record);
			createdDecisionPaths.push(decisionFilePath(root, id));

			const cardAbs = cardFilePath(root, card.card);
			if (!writtenBackups.has(cardAbs)) {
				writtenBackups.set(cardAbs, origCardTexts.get(card.card) ?? null);
			}
			await writeCardRecord(root, {
				...card,
				status: cardStatusForChosen(chosen),
				decision: id,
			});
			results.push(formatSingleCardResult(record, relPath));
		}
	} catch (error) {
		// Best-effort rollback so no partial writes persist on failure
		for (const decPath of createdDecisionPaths) {
			await unlink(decPath).catch(() => {});
		}
		for (const [absPath, orig] of writtenBackups.entries()) {
			if (orig === null) {
				await unlink(absPath).catch(() => {});
			} else {
				await writeFileAtomic(absPath, orig).catch(() => {});
			}
		}
		throw error;
	}

	return isBatch ? { decisions: results } : (results[0] as DecisionRecordSingleResult);
}

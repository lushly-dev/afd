/**
 * Multi-persona panel orchestration (`panel-review`, Agent-First Design Phase C3, #2563).
 * Runs modality-enforced persona walks across jobs, enforces fail-closed server-derived author
 * independence (`AUTHOR_CANNOT_REVIEW`) and round/cost budgets (`BUDGET_EXCEEDED` pre-flight vs
 * `stoppedBy: 'budget'` mid-flight), measures cross-family finding overlap, settles quorum-backed
 * non-trigger items provisionally (recording Mode 3 answers via `DirectRegistry` when capture
 * sets are supplied), emits open decision cards for all five escalation triggers, and supports
 * withdrawing misconfigured runs while preserving every person-decided card and retaining spent
 * budget history.
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { type Dirent, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DesignCardRecord, EscalationTrigger } from './card-types.js';
import { cardFilePath, generateCardId, readAllCards, writeCardRecord } from './cards.js';
import type { LoadedConfig } from './config.js';
import {
	compareCodeUnits,
	readAllDecisions,
	supersededIdsFromRecords,
	typedError,
} from './decisions-store.js';
import type { UnmeasuredEntry } from './design-types.js';
import {
	DEFAULT_PANEL_SIZE,
	PANEL_RUNS_DIR,
	type PanelReviewEscalatedItem,
	type PanelReviewProvisionalItem,
	type PanelReviewRequest,
	type PanelReviewResult,
	type PanelReviewRunRecord,
	type PanelReviewRunRequest,
	type PanelReviewRunResult,
	type PanelReviewStoppedBy,
	type PanelReviewWithdrawRequest,
	type PanelReviewWithdrawResult,
	RUN_ID_LENGTH,
	RUN_ID_PATTERN,
	type RunPanelReviewOptions,
	type StoredProvisionalAgreement,
} from './panel-review-types.js';
import { parsePanelReviewRequest } from './panel-review-validate.js';
import {
	type Modality,
	type PanelWalkResult,
	type PersonaDefinition,
	WALK_ID_PATTERN,
} from './panel-types.js';
import { readWalkRecord, resolveWalkJob, runPanelWalk } from './panel-walk.js';
import { CROCKFORD_BASE32 } from './point.js';
import { runReview } from './review.js';
import {
	assertRealContained,
	assertRealFileContained,
	specimenDataDir,
	withFileLock,
	writeFileAtomic,
} from './sets.js';

const execFileAsync = promisify(execFile);
const SAFE_CHANGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_GIT_REF = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_MAX_COST_USD = 10;
const DEFAULT_MEMBER_COST_USD = 0.5;
const COST_EPSILON = 1e-9;

const PERSON_DECIDED_STATUSES = new Set(['approved', 'rejected', 'changes-requested', 'deferred']);

const DEFAULT_PANEL_ROSTER: readonly PersonaDefinition[] = [
	{ id: 'panel-pointer-a', modality: 'pointer', name: 'Pointer reviewer A', family: 'family-a' },
	{ id: 'panel-keyboard-b', modality: 'keyboard', name: 'Keyboard reviewer B', family: 'family-b' },
	{
		id: 'panel-sr-a',
		modality: 'screen-reader',
		name: 'Screen-reader reviewer A',
		family: 'family-a',
	},
	{
		id: 'panel-low-vision-b',
		modality: 'low-vision',
		name: 'Low-vision reviewer B',
		family: 'family-b',
	},
	{ id: 'panel-pointer-c', modality: 'pointer', name: 'Pointer reviewer C', family: 'family-c' },
];

/** Generate a 12-character lowercase Crockford base-32 run id (`run-<12>`). */
export function generateRunId(): string {
	const bytes = randomBytes(RUN_ID_LENGTH);
	let body = '';
	for (let i = 0; i < RUN_ID_LENGTH; i++) {
		body += CROCKFORD_BASE32[(bytes[i] ?? 0) & 31];
	}
	return `run-${body}`;
}

export function panelRunsDir(root: string): string {
	return join(specimenDataDir(root), PANEL_RUNS_DIR);
}

export function panelRunFilePath(root: string, runId: string): string {
	return join(panelRunsDir(root), `${runId}.json`);
}

export async function readAllPanelRuns(root: string): Promise<PanelReviewRunRecord[]> {
	const dir = panelRunsDir(root);
	if (!existsSync(dir)) return [];
	await assertRealContained(root, dir, `Panel runs directory escapes workspace root: ${dir}`);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
	const files = entries
		.filter((e) => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json'))
		.map((e) => e.name)
		.sort(compareCodeUnits);
	const runs: PanelReviewRunRecord[] = [];
	for (const name of files) {
		const runId = name.slice(0, -5);
		if (!RUN_ID_PATTERN.test(runId)) continue;
		const filePath = join(dir, name);
		try {
			await assertRealFileContained(root, filePath, `Panel run escapes workspace root: ${name}`);
			const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PanelReviewRunRecord;
			if (parsed?.version === 1 && parsed.run === runId) {
				runs.push(parsed);
			}
		} catch {
			// Skip unreadable or non-conforming scratch run records.
		}
	}
	return runs;
}

async function readPanelRun(
	root: string,
	runId: string
): Promise<PanelReviewRunRecord | undefined> {
	if (!RUN_ID_PATTERN.test(runId)) return undefined;
	const filePath = panelRunFilePath(root, runId);
	if (!existsSync(filePath)) return undefined;
	await assertRealFileContained(root, filePath, `Panel run file escapes workspace root: ${runId}`);
	const parsed = JSON.parse(await readFile(filePath, 'utf8')) as PanelReviewRunRecord;
	if (parsed?.version !== 1 || parsed.run !== runId) return undefined;
	return parsed;
}

async function writePanelRun(root: string, record: PanelReviewRunRecord): Promise<void> {
	const dir = panelRunsDir(root);
	await assertRealContained(root, dir, `Panel runs directory escapes workspace root: ${dir}`);
	await mkdir(dir, { recursive: true });
	const filePath = panelRunFilePath(root, record.run);
	await assertRealContained(root, filePath, `Panel run file escapes workspace root: ${record.run}`);
	await writeFileAtomic(filePath, `${JSON.stringify(record, null, '\t')}\n`);
}

interface ChangeMetadata {
	author?: string;
	touches: string[];
	guidanceChange: boolean;
	irreversible: boolean;
	modifiesDefault: boolean;
	noPrecedent: boolean;
}

async function readServerChangeMetadata(
	config: LoadedConfig,
	change: string,
	options?: RunPanelReviewOptions
): Promise<ChangeMetadata> {
	const meta: ChangeMetadata = {
		touches: [],
		guidanceChange: false,
		irreversible: false,
		modifiesDefault: false,
		noPrecedent: false,
	};

	if (options?.changeAuthor?.trim()) {
		meta.author = options.changeAuthor.trim();
	}

	// 1. Authoritative change metadata file under `specimens/changes/<change>.json`
	if (SAFE_CHANGE_ID.test(change)) {
		const changesDir = join(resolve(config.root), 'specimens', 'changes');
		const changeFile = join(changesDir, `${change}.json`);
		if (existsSync(changeFile)) {
			await assertRealContained(
				config.root,
				changesDir,
				`Changes directory escapes workspace root: ${changesDir}`
			);
			await assertRealFileContained(
				changesDir,
				changeFile,
				`Change metadata escapes specimens/changes/: ${change}`
			);
			try {
				const raw = JSON.parse(await readFile(changeFile, 'utf8')) as {
					author?: unknown;
					touches?: unknown;
					guidanceChange?: unknown;
					irreversible?: unknown;
					modifiesDefault?: unknown;
					noPrecedent?: unknown;
				};
				if (!meta.author && typeof raw.author === 'string' && raw.author.trim()) {
					meta.author = raw.author.trim();
				}
				if (Array.isArray(raw.touches)) {
					meta.touches = raw.touches.filter(
						(t): t is string => typeof t === 'string' && t.trim().length > 0
					);
				}
				if (raw.guidanceChange === true) meta.guidanceChange = true;
				if (raw.irreversible === true) meta.irreversible = true;
				if (raw.modifiesDefault === true) meta.modifiesDefault = true;
				if (raw.noPrecedent === true) meta.noPrecedent = true;
			} catch {
				// Fall through to other authoritative sources.
			}
		}
	}

	// 2. Workspace config `panel.changeAuthors[change]` (prototype-safe lookup)
	const changeAuthors = config.config.panel?.changeAuthors;
	if (!meta.author && changeAuthors && Object.hasOwn(changeAuthors, change)) {
		const configuredAuthor = changeAuthors[change]?.trim();
		if (configuredAuthor) meta.author = configuredAuthor;
	}

	// 3. Git commit metadata (strictly single commit, rejecting ranges `..` and option prefixes `-`)
	if (
		!meta.author &&
		SAFE_GIT_REF.test(change) &&
		!change.startsWith('-') &&
		!change.includes('..')
	) {
		try {
			const { stdout } = await execFileAsync(
				'git',
				['log', '-1', '--format=%an', '--end-of-options', `${change}^{commit}`, '--'],
				{ cwd: config.root, timeout: 3000 }
			);
			const author = stdout.trim();
			if (author && !author.includes('\n')) {
				meta.author = author;
			}
		} catch {
			// Not a valid single git commit ref; leave undefined.
		}
	}
	return meta;
}

function selectPanelRoster(config: LoadedConfig, panelSize: number): PersonaDefinition[] {
	const configured = config.config.panel?.personas ?? [];
	const roster: PersonaDefinition[] = [];
	const seenIds = new Set<string>();
	for (const persona of configured) {
		if (roster.length >= panelSize) break;
		if (seenIds.has(persona.id)) continue;
		seenIds.add(persona.id);
		roster.push({
			...persona,
			family: persona.family ?? `family-${roster.length % 2 === 0 ? 'a' : 'b'}`,
		});
	}
	let extraIndex = 0;
	while (roster.length < panelSize) {
		const template = DEFAULT_PANEL_ROSTER[
			extraIndex % DEFAULT_PANEL_ROSTER.length
		] as PersonaDefinition;
		const id =
			extraIndex < DEFAULT_PANEL_ROSTER.length
				? template.id
				: `${template.id}-${Math.floor(extraIndex / DEFAULT_PANEL_ROSTER.length) + 1}`;
		extraIndex += 1;
		if (seenIds.has(id)) continue;
		seenIds.add(id);
		roster.push({ ...template, id });
	}
	return roster;
}

function configWithRoster(
	config: LoadedConfig,
	roster: readonly PersonaDefinition[]
): LoadedConfig {
	const existing = config.config.panel?.personas ?? [];
	const mergedMap = new Map<string, PersonaDefinition>();
	for (const p of existing) mergedMap.set(p.id, p);
	for (const p of roster) {
		if (!mergedMap.has(p.id)) mergedMap.set(p.id, p);
	}
	return {
		...config,
		config: {
			...config.config,
			panel: {
				...config.config.panel,
				personas: [...mergedMap.values()],
			},
		},
	};
}

function normalizeFindingKey(job: string, where: string): string {
	return `${job}::${where.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function defaultPanelUnmeasured(includeIdentityGap: boolean): UnmeasuredEntry[] {
	const list: UnmeasuredEntry[] = [
		{
			area: 'forced-colors',
			reason: 'Forced-colors (high-contrast OS mode) rendering is not evaluated by panel walks.',
			addToMeasure: 'Run specimen-themes or high-contrast Specimen captures before release.',
		},
		{
			area: 'motion',
			reason: 'Reduced-motion transition comfort is not evaluated by panel walks.',
			addToMeasure: 'Capture reduced-motion contexts in Specimen and inspect motion transitions.',
		},
	];
	if (includeIdentityGap) {
		list.unshift({
			area: 'reviewer-identity',
			reason:
				'Reviewer actor identity or authoritative change authorship was unavailable; workspace permits unverified local panel runs.',
			addToMeasure:
				'Provide an authenticated ctx.actor.id and change metadata so author independence is verified.',
		});
	}
	return list;
}

async function resolveBaselineWalkMap(
	root: string,
	baseline: string | undefined
): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	if (!baseline) return map;

	if (WALK_ID_PATTERN.test(baseline)) {
		const walkRec = await readWalkRecord(root, baseline);
		if (!walkRec) {
			throw typedError(
				'WALK_NOT_FOUND',
				`Baseline walk '${baseline}' was not found under .specimen/walks/.`,
				'Run panel-walk or panel-review first to produce a baseline walk or run id.'
			);
		}
		map.set(`${walkRec.result.job}::${walkRec.result.modality}`, walkRec.walk);
		return map;
	}

	if (RUN_ID_PATTERN.test(baseline)) {
		const runRec = await readPanelRun(root, baseline);
		if (!runRec) {
			throw typedError(
				'RUN_NOT_FOUND',
				`Baseline panel run '${baseline}' was not found.`,
				'Pass a valid run id returned by panel-review or a walk id returned by panel-walk.'
			);
		}
		for (const walkId of runRec.walks) {
			const walkRec = await readWalkRecord(root, walkId);
			if (!walkRec) continue;
			const key = `${walkRec.result.job}::${walkRec.result.modality}`;
			if (!map.has(key)) map.set(key, walkRec.walk);
		}
		return map;
	}

	throw typedError(
		'VALIDATION_ERROR',
		`Unsupported baseline identifier '${baseline}'.`,
		'Pass a walk id (walk-<12>) or prior panel run id (run-<12>) as baseline.'
	);
}

async function runWithdrawMode(
	config: LoadedConfig,
	request: PanelReviewWithdrawRequest,
	now: Date
): Promise<PanelReviewWithdrawResult> {
	const record = await readPanelRun(config.root, request.run);
	if (!record) {
		throw typedError(
			'RUN_NOT_FOUND',
			`Panel review run '${request.run}' was not found.`,
			'Check the run id returned by panel-review before calling panel-review with action: "withdraw".',
			{ run: request.run }
		);
	}

	const allCards = await readAllCards(config.root);
	const cardsToWithdraw: Array<{ card: DesignCardRecord; origContent: string | null }> = [];
	const preservedDecidedCards: string[] = [];

	for (const card of allCards) {
		if (card.run !== record.run) continue;
		const isPersonDecided = card.decision !== undefined || PERSON_DECIDED_STATUSES.has(card.status);
		if (isPersonDecided) {
			preservedDecidedCards.push(card.card);
			continue;
		}
		if (card.status === 'open' || card.status === 'provisional') {
			const origContent = await readFile(cardFilePath(config.root, card.card), 'utf8').catch(
				() => null
			);
			cardsToWithdraw.push({ card, origContent });
		}
	}

	let withdrawnProvisional = 0;
	const updatedProvisional = record.provisionalItems.map((item) => {
		if (!item.withdrawn) {
			withdrawnProvisional += 1;
		}
		return { ...item, withdrawn: true };
	});

	const withdrawnCards: string[] = [];
	const updatedCardBackups: Array<{ absPath: string; origContent: string | null }> = [];
	try {
		for (const entry of cardsToWithdraw) {
			const absPath = cardFilePath(config.root, entry.card.card);
			updatedCardBackups.push({ absPath, origContent: entry.origContent });
			await writeCardRecord(config.root, { ...entry.card, status: 'withdrawn' });
			withdrawnCards.push(entry.card.card);
		}
		await writePanelRun(config.root, {
			...record,
			status: 'withdrawn',
			withdrawnAt: now.toISOString(),
			withdrawnReason: request.reason,
			provisionalItems: updatedProvisional,
		});
	} catch (error) {
		for (const backup of updatedCardBackups) {
			if (backup.origContent !== null) {
				await writeFileAtomic(backup.absPath, backup.origContent).catch(() => {});
			}
		}
		throw error;
	}

	return {
		run: record.run,
		withdrawn: true,
		withdrawnCards,
		withdrawnProvisional,
		preservedDecidedCards,
		reason: request.reason,
	};
}

interface CompletedMemberWalk {
	job: string;
	member: PersonaDefinition;
	family: string;
	modality: Modality;
	result: PanelWalkResult;
}

interface FindingGroup {
	key: string;
	job: string;
	where: string;
	summaries: string[];
	evidences: Array<'observed' | 'hypothesis'>;
	againstMembers: Set<string>;
	againstEvidence: string[];
	walks: string[];
}

function isCleanWalk(walk: CompletedMemberWalk): boolean {
	return (
		walk.result.ending === 'done' &&
		walk.result.path.done &&
		walk.result.path.failed === 0 &&
		walk.result.comparison?.worse !== 'current'
	);
}

function classifyStructuredChangeTrigger(
	jobId: string,
	where: string | undefined,
	changeMeta: ChangeMetadata,
	coveredTargets: ReadonlySet<string>,
	hasCaptureConflict: boolean
): EscalationTrigger | undefined {
	const whereLower = where?.trim().toLowerCase() ?? '';
	const jobLower = jobId.trim().toLowerCase();
	const touchesPatterns =
		changeMeta.guidanceChange ||
		changeMeta.touches.some((t) => t.startsWith('specimens/patterns/')) ||
		whereLower.startsWith('specimens/patterns/');
	if (touchesPatterns) {
		return 'guidance-change';
	}
	const touchesIrreversibleOrDefault =
		changeMeta.irreversible ||
		changeMeta.modifiesDefault ||
		changeMeta.touches.some((t) => t.startsWith('afd-defaults/')) ||
		whereLower.startsWith('afd-defaults/');
	if (touchesIrreversibleOrDefault) {
		return 'irreversible-or-default';
	}
	const touchesCoveredTarget =
		hasCaptureConflict ||
		(whereLower.length > 0 && coveredTargets.has(whereLower)) ||
		coveredTargets.has(jobLower) ||
		changeMeta.touches.some((t) => coveredTargets.has(t.trim().toLowerCase()));
	if (touchesCoveredTarget) {
		return 'conflicts-recorded-decision';
	}
	return undefined;
}

function classifyEscalationTrigger(
	group: FindingGroup,
	forCount: number,
	againstCount: number,
	totalForJob: number,
	changeMeta: ChangeMetadata,
	coveredTargets: ReadonlySet<string>,
	hasCaptureConflict: boolean
): EscalationTrigger | undefined {
	const structured = classifyStructuredChangeTrigger(
		group.job,
		group.where,
		changeMeta,
		coveredTargets,
		hasCaptureConflict
	);
	if (structured) return structured;
	const minority = Math.min(forCount, againstCount);
	if (
		(totalForJob >= 2 && forCount === againstCount && againstCount > 0) ||
		(totalForJob >= 3 &&
			forCount > 0 &&
			againstCount > 0 &&
			minority >= Math.floor(totalForJob / 2))
	) {
		return 'split-3-to-2';
	}
	if (changeMeta.noPrecedent) {
		return 'no-precedent';
	}
	return undefined;
}

async function runReviewMode(
	config: LoadedConfig,
	request: PanelReviewRunRequest,
	options: RunPanelReviewOptions | undefined,
	now: Date
): Promise<PanelReviewRunResult> {
	// 1. Fail-closed server-derived author independence check (`AUTHOR_CANNOT_REVIEW`)
	const changeMeta = await readServerChangeMetadata(config, request.change, options);
	const derivedAuthor = changeMeta.author;
	const reviewerActorId = options?.actorId?.trim();
	const callerAuthor = request.author?.trim();
	const allowUnverified = config.config.panel?.allowUnverifiedLocal === true;
	let includeIdentityGap = false;

	if (!reviewerActorId) {
		if (allowUnverified) {
			includeIdentityGap = true;
		} else {
			throw typedError(
				'AUTHOR_CANNOT_REVIEW',
				`Panel review for '${request.change}' requires a verified reviewer identity (ctx.actor.id) independent of the change author.`,
				'Run panel-review from an authenticated independent reviewer identity (or enable panel.allowUnverifiedLocal in specimen.config.json for local-only runs).'
			);
		}
	} else if (!derivedAuthor) {
		if (allowUnverified) {
			includeIdentityGap = true;
			if (callerAuthor && reviewerActorId.toLowerCase() === callerAuthor.toLowerCase()) {
				throw typedError(
					'AUTHOR_CANNOT_REVIEW',
					`Author '${callerAuthor}' cannot run the independent panel review for '${request.change}'.`,
					'Have an independent reviewer (whose ctx.actor.id differs from the change author) run panel-review.'
				);
			}
		} else {
			throw typedError(
				'AUTHOR_CANNOT_REVIEW',
				`Could not derive an authoritative change author for '${request.change}' from specimens/changes/, panel.changeAuthors, or git commit metadata.`,
				'Record authoritative authorship for the change (or enable panel.allowUnverifiedLocal for local-only runs) so independent review can be verified.'
			);
		}
	} else {
		if (callerAuthor && callerAuthor.toLowerCase() !== derivedAuthor.toLowerCase()) {
			throw typedError(
				'AUTHOR_CANNOT_REVIEW',
				`Supplied author '${callerAuthor}' disagrees with server-derived change author '${derivedAuthor}'.`,
				'Have an independent reviewer run panel-review without overriding the server-derived author.'
			);
		}
		if (reviewerActorId.toLowerCase() === derivedAuthor.toLowerCase()) {
			throw typedError(
				'AUTHOR_CANNOT_REVIEW',
				`Author '${derivedAuthor}' cannot run the independent panel review for '${request.change}'.`,
				'Have an independent reviewer (whose ctx.actor.id differs from the change author) run panel-review.'
			);
		}
	}

	// 2. Pre-flight budget check (`BUDGET_EXCEEDED`) — retains ALL incurred rounds & costs (including withdrawn runs)
	const allPriorRunsForChange = (await readAllPanelRuns(config.root)).filter(
		(r) => r.change === request.change
	);
	const priorRounds = allPriorRunsForChange.length;
	const priorCostUsd = allPriorRunsForChange.reduce((sum, r) => sum + r.costUsd, 0);
	const maxRounds = request.budget?.maxRounds ?? DEFAULT_MAX_ROUNDS;
	const maxCostUsd = request.budget?.maxCostUsd ?? DEFAULT_MAX_COST_USD;
	const memberCostUsd = config.config.panel?.memberCostUsd ?? DEFAULT_MEMBER_COST_USD;

	if (
		maxRounds === 0 ||
		maxCostUsd === 0 ||
		priorRounds >= maxRounds ||
		priorCostUsd >= maxCostUsd - COST_EPSILON ||
		priorCostUsd + memberCostUsd > maxCostUsd + COST_EPSILON
	) {
		throw typedError(
			'BUDGET_EXCEEDED',
			`Panel review budget exhausted for '${request.change}' (rounds: ${priorRounds}/${maxRounds}, cost: $${priorCostUsd.toFixed(2)}/$${maxCostUsd.toFixed(2)}).`,
			'Inspect already-emitted cards in design-card-list or raise budget.maxRounds / budget.maxCostUsd before starting another panel-review round.',
			{
				change: request.change,
				priorRounds,
				maxRounds,
				priorCostUsd,
				maxCostUsd,
			}
		);
	}

	// 3. Validate baseline and all requested jobs exist BEFORE launching any walks
	const baselineWalkMap = await resolveBaselineWalkMap(config.root, request.baseline);
	for (const jobId of request.jobs) {
		await resolveWalkJob(config, jobId);
	}

	// Optional capture-set review resolution (for real Mode 3 provisional review items & conflict detection)
	let captureReviewItems: Array<{ id: string; touchedChoices: string[] }> = [];
	if (request.captures?.before && request.captures?.after) {
		const rev = await runReview(config.root, {
			before: request.captures.before,
			after: request.captures.after,
		});
		captureReviewItems = rev.open.map((entry) => ({
			id: entry.item,
			touchedChoices: entry.decisions.map((d) => d.decision),
		}));
	}
	const hasCaptureConflict = captureReviewItems.some((item) => item.touchedChoices.length > 0);

	// 4. Select panel roster and run modality-enforced walks with mid-flight budget guard
	const panelSize = request.panelSize ?? DEFAULT_PANEL_SIZE;
	const quorumSize = Math.ceil(panelSize / 2);
	const roster = selectPanelRoster(config, panelSize);
	const effectiveConfig = configWithRoster(config, roster);

	const completed: CompletedMemberWalk[] = [];
	let spentCostUsd = priorCostUsd;
	let roundCostUsd = 0;
	let stoppedByBudget = false;
	let hasAnyGateRegression = false;

	outer: for (const jobId of request.jobs) {
		for (const member of roster) {
			if (completed.length > 0 && spentCostUsd + memberCostUsd > maxCostUsd + COST_EPSILON) {
				stoppedByBudget = true;
				break outer;
			}
			const matchedBaselineWalk = baselineWalkMap.get(`${jobId}::${member.modality}`);
			const walkResult = await runPanelWalk(
				effectiveConfig,
				{
					job: jobId,
					persona: member.id,
					modality: member.modality,
					target: request.target,
					appDate: request.appDate,
					...(matchedBaselineWalk ? { baselineWalk: matchedBaselineWalk } : {}),
				},
				{
					...(options?.driver ? { driver: options.driver } : {}),
					...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
					...(options?.signal ? { signal: options.signal } : {}),
					...(options?.blindJudge ? { blindJudge: options.blindJudge } : {}),
				}
			);
			spentCostUsd += memberCostUsd;
			roundCostUsd += memberCostUsd;
			if (walkResult.path.failed > 0 || walkResult.comparison?.worse === 'current') {
				hasAnyGateRegression = true;
			}
			completed.push({
				job: jobId,
				member,
				family: member.family ?? member.modality,
				modality: member.modality,
				result: walkResult,
			});
		}
	}

	// 5. Measure overlap across families and group findings
	const families = [...new Set(completed.map((c) => c.family))].sort(compareCodeUnits);
	const walksByJob = new Map<string, CompletedMemberWalk[]>();
	for (const entry of completed) {
		const list = walksByJob.get(entry.job) ?? [];
		list.push(entry);
		walksByJob.set(entry.job, list);
	}

	const groups = new Map<string, FindingGroup>();
	for (const entry of completed) {
		for (const finding of entry.result.findings) {
			const key = normalizeFindingKey(entry.job, finding.where);
			const existing = groups.get(key);
			if (existing) {
				existing.summaries.push(finding.summary);
				existing.evidences.push(finding.evidence);
				existing.againstMembers.add(entry.member.id);
				existing.againstEvidence.push(`[${entry.member.id}/${entry.modality}] ${finding.summary}`);
				if (!existing.walks.includes(entry.result.walk)) {
					existing.walks.push(entry.result.walk);
				}
			} else {
				groups.set(key, {
					key,
					job: entry.job,
					where: finding.where,
					summaries: [finding.summary],
					evidences: [finding.evidence],
					againstMembers: new Set([entry.member.id]),
					againstEvidence: [`[${entry.member.id}/${entry.modality}] ${finding.summary}`],
					walks: [entry.result.walk],
				});
			}
		}
	}

	let sharedFindings = 0;
	let uniqueFindings = 0;
	for (const group of groups.values()) {
		if (group.againstMembers.size >= 2) sharedFindings += 1;
		else uniqueFindings += 1;
	}

	// Collect active recorded decision targets for exact `conflicts-recorded-decision` detection
	const allDecisions = await readAllDecisions(config.root);
	const supersededIds = supersededIdsFromRecords(allDecisions);
	const coveredTargets = new Set<string>();
	for (const dec of allDecisions) {
		if (supersededIds.has(dec.id)) continue;
		if (dec.kind === 'choice' && dec.status === 'current') {
			for (const spec of dec.subjects.specimens ?? [])
				coveredTargets.add(spec.trim().toLowerCase());
			for (const file of dec.subjects.files ?? []) coveredTargets.add(file.trim().toLowerCase());
			for (const tok of dec.subjects.tokens ?? []) coveredTargets.add(tok.trim().toLowerCase());
		} else if (dec.kind === 'card' && dec.chosen === 'approve') {
			if (dec.meantToFix?.target) coveredTargets.add(dec.meantToFix.target.trim().toLowerCase());
		}
	}

	const runId = generateRunId();
	const round = priorRounds + 1;
	const provisional: PanelReviewProvisionalItem[] = [];
	const storedProvisional: StoredProvisionalAgreement[] = [];
	const escalated: PanelReviewEscalatedItem[] = [];
	const cardsToWrite: DesignCardRecord[] = [];
	const escalatedCards: string[] = [];
	const rejectedJobs = new Set<string>();

	const orderedGroups = [...groups.values()].sort((a, b) => compareCodeUnits(a.key, b.key));
	let itemCounter = 0;

	for (const group of orderedGroups) {
		const jobWalks = walksByJob.get(group.job) ?? [];
		// Do not settle or escalate findings for jobs that did not reach quorum before a budget stop
		if (jobWalks.length < quorumSize) continue;

		const reviewersForJob = jobWalks.map((w) => w.member.id);
		const againstCount = group.againstMembers.size;
		const forWalks = jobWalks.filter(
			(w) => !group.againstMembers.has(w.member.id) && isCleanWalk(w)
		);
		const forCount = forWalks.length;
		const split = `${Math.max(forCount, againstCount)}-${Math.min(forCount, againstCount)}`;
		const trigger = classifyEscalationTrigger(
			group,
			forCount,
			againstCount,
			jobWalks.length,
			changeMeta,
			coveredTargets,
			hasCaptureConflict
		);

		if (trigger !== undefined) {
			const jobHasRegression = jobWalks.some(
				(w) => w.result.path.failed > 0 || w.result.comparison?.worse === 'current'
			);
			const forEvidence =
				forWalks.length > 0
					? forWalks.map(
							(w) =>
								`[${w.member.id}/${w.modality}] Completed '${group.job}' (${w.result.ending}) without flagging '${group.where}'.`
						)
					: [`Existing design on '${group.where}' remained reachable during walk.`];
			const againstEvidence =
				group.againstEvidence.length > 0
					? group.againstEvidence
					: [`Flagged issue at '${group.where}'.`];
			const cardId = generateCardId();
			const question = `Resolve ${group.where} in job '${group.job}' (${group.summaries[0] ?? 'panel disagreement'})`;
			const changeSignature = createHash('sha256')
				.update(
					JSON.stringify({
						change: request.change,
						job: group.job,
						where: group.where.trim().toLowerCase(),
					}),
					'utf8'
				)
				.digest('hex');

			cardsToWrite.push({
				card: cardId,
				run: runId,
				scope: trigger === 'guidance-change' ? 'guidance' : 'interface',
				what: question,
				owner: trigger === 'irreversible-or-default' ? 'default' : 'product',
				touches: [group.job, group.where, ...changeMeta.touches],
				severity:
					trigger === 'irreversible-or-default' || trigger === 'conflicts-recorded-decision'
						? 'blocker'
						: 'major',
				visual: {
					kind: request.captures?.before && request.captures?.after ? 'captures' : 'transcript',
					...(request.captures?.before ? { before: request.captures.before } : {}),
					...(request.captures?.after ? { after: request.captures.after } : {}),
					summary: `Panel (${split}) on '${group.job}' at '${group.where}': ${group.summaries[0] ?? 'disagreement'}.`,
				},
				why: {
					findings: group.summaries.map((summary, idx) => ({
						summary,
						evidence: group.evidences[idx] ?? 'observed',
					})),
					evidenceForBothSides: {
						for: forEvidence,
						against: againstEvidence,
					},
					reviewerCount: jobWalks.length,
					split,
					trigger,
				},
				effect: {
					gatesBefore: { passed: 0, failed: 0 },
					gatesAfter: {
						passed: jobWalks.filter((w) => w.result.path.failed === 0).length,
						failed: jobWalks.filter((w) => w.result.path.failed > 0).length,
					},
					checksSummary: `${jobWalks.length} panel walk(s) completed for '${group.job}'.`,
					regression: jobHasRegression,
				},
				risk: {
					affects: [request.change, group.job],
					undoable: trigger !== 'irreversible-or-default',
				},
				status: 'open',
				changeSignature,
				createdAt: now.toISOString(),
			});
			escalatedCards.push(cardId);
			escalated.push({
				card: cardId,
				trigger,
				split,
				question,
				evidenceForBothSides: {
					for: forEvidence,
					against: againstEvidence,
				},
			});
		} else if (againstCount > forCount && againstCount >= quorumSize) {
			itemCounter += 1;
			const itemId = `item-${runId.slice(4, 10)}-${itemCounter}`;
			rejectedJobs.add(group.job);
			const summary = `Panel (${split}) agreed to flag '${group.where}' in '${group.job}': ${group.summaries[0]}`;
			const decidedBy = {
				kind: 'panel' as const,
				reviewers: reviewersForJob,
				split,
			};
			provisional.push({
				item: itemId,
				summary,
				decidedBy,
				provisional: true,
			});
			storedProvisional.push({
				item: itemId,
				summary,
				verdict: 'reject',
				decidedBy,
				evidence: {
					...(request.captures?.after ? { visual: request.captures.after } : {}),
					...(group.walks[0] ? { walk: group.walks[0] } : {}),
				},
			});
		} else if (forCount > againstCount && forCount >= quorumSize) {
			itemCounter += 1;
			const itemId = `item-${runId.slice(4, 10)}-${itemCounter}`;
			const summary = `Panel (${split}) agreed '${group.where}' in '${group.job}' is acceptable.`;
			const decidedBy = {
				kind: 'panel' as const,
				reviewers: reviewersForJob,
				split,
			};
			provisional.push({
				item: itemId,
				summary,
				decidedBy,
				provisional: true,
			});
			storedProvisional.push({
				item: itemId,
				summary,
				verdict: 'accept',
				decidedBy,
				evidence: {
					...(request.captures?.after ? { visual: request.captures.after } : {}),
					...(group.walks[0] ? { walk: group.walks[0] } : {}),
				},
			});
		}
	}

	// Record clean-completion provisional agreements ONLY for jobs that reached quorum,
	// had a strict majority completing cleanly, and were not majority-rejected by findings.
	for (const jobId of request.jobs) {
		const jobWalks = walksByJob.get(jobId) ?? [];
		if (jobWalks.length < quorumSize) continue;
		if (rejectedJobs.has(jobId)) continue;
		const cleanWalks = jobWalks.filter((w) => isCleanWalk(w));
		if (cleanWalks.length <= jobWalks.length / 2) continue;

		// If the change itself triggers structured escalation even with clean walks (e.g., guidance-change,
		// irreversible/default, conflicts-recorded-decision, or no-precedent), never settle provisionally;
		// emit a card unless one was already emitted for this job.
		const alreadyEscalatedForJob = cardsToWrite.some((c) => c.touches.includes(jobId));
		const structuredTrigger: EscalationTrigger | undefined =
			classifyStructuredChangeTrigger(
				jobId,
				undefined,
				changeMeta,
				coveredTargets,
				hasCaptureConflict
			) ?? (changeMeta.noPrecedent ? 'no-precedent' : undefined);
		if (structuredTrigger) {
			if (alreadyEscalatedForJob) continue;
			const cardId = generateCardId();
			const split = `${cleanWalks.length}-${jobWalks.length - cleanWalks.length}`;
			const question = `Approve ${structuredTrigger} change '${request.change}' affecting job '${jobId}'`;
			const forEvidence = cleanWalks.map(
				(w) => `[${w.member.id}/${w.modality}] Completed '${jobId}' cleanly.`
			);
			const againstEvidence = [
				`Escalation trigger '${structuredTrigger}' requires person decision before settling '${request.change}'.`,
			];
			cardsToWrite.push({
				card: cardId,
				run: runId,
				scope: structuredTrigger === 'guidance-change' ? 'guidance' : 'interface',
				what: question,
				owner: structuredTrigger === 'irreversible-or-default' ? 'default' : 'product',
				touches: [jobId, ...changeMeta.touches],
				severity:
					structuredTrigger === 'irreversible-or-default' ||
					structuredTrigger === 'conflicts-recorded-decision'
						? 'blocker'
						: 'major',
				visual: {
					kind: request.captures?.before && request.captures?.after ? 'captures' : 'transcript',
					...(request.captures?.before ? { before: request.captures.before } : {}),
					...(request.captures?.after ? { after: request.captures.after } : {}),
					summary: `Change '${request.change}' hit '${structuredTrigger}' on job '${jobId}'.`,
				},
				why: {
					findings: [{ summary: againstEvidence[0] as string, evidence: 'observed' }],
					evidenceForBothSides: { for: forEvidence, against: againstEvidence },
					reviewerCount: jobWalks.length,
					split,
					trigger: structuredTrigger,
				},
				effect: {
					gatesBefore: { passed: 0, failed: 0 },
					gatesAfter: { passed: cleanWalks.length, failed: jobWalks.length - cleanWalks.length },
					checksSummary: `${jobWalks.length} panel walk(s) completed for '${jobId}'.`,
					regression: jobWalks.some(
						(w) => w.result.path.failed > 0 || w.result.comparison?.worse === 'current'
					),
				},
				risk: {
					affects: [request.change, jobId],
					undoable: structuredTrigger !== 'irreversible-or-default',
				},
				status: 'open',
				createdAt: now.toISOString(),
			});
			escalatedCards.push(cardId);
			escalated.push({
				card: cardId,
				trigger: structuredTrigger,
				split,
				question,
				evidenceForBothSides: { for: forEvidence, against: againstEvidence },
			});
			continue;
		}

		itemCounter += 1;
		const itemId = `item-${runId.slice(4, 10)}-${itemCounter}`;
		const reviewers = jobWalks.map((w) => w.member.id);
		const split = `${cleanWalks.length}-${jobWalks.length - cleanWalks.length}`;
		const summary = `Panel (${split}) agreed job '${jobId}' completed cleanly across ${jobWalks.length} reviewer(s).`;
		const decidedBy = {
			kind: 'panel' as const,
			reviewers,
			split,
		};
		provisional.push({
			item: itemId,
			summary,
			decidedBy,
			provisional: true,
		});
		storedProvisional.push({
			item: itemId,
			summary,
			verdict: 'accept',
			decidedBy,
			evidence: {
				...(request.captures?.after ? { visual: request.captures.after } : {}),
				...(jobWalks[0]?.result.walk ? { walk: jobWalks[0].result.walk } : {}),
			},
		});
	}

	// 6. Mode 3 provisional settlement via in-process DirectRegistry for real capture-set review items
	const nonConflictingCaptureItems = captureReviewItems.filter(
		(item) => item.touchedChoices.length === 0
	);
	const shouldRecordProvisional =
		Boolean(options?.recordProvisional) &&
		nonConflictingCaptureItems.length > 0 &&
		Boolean(derivedAuthor) &&
		Boolean(reviewerActorId) &&
		escalated.length === 0 &&
		storedProvisional.length > 0;

	// Determine stopping reason
	const currentFindingKeys = orderedGroups.map((g) => g.key);
	const priorActiveRuns = allPriorRunsForChange.filter((r) => r.status !== 'withdrawn');
	const priorFindingKeys = new Set(priorActiveRuns.flatMap((r) => r.findingKeys));
	const hasNewFindings = currentFindingKeys.some((k) => !priorFindingKeys.has(k));
	let stoppedBy: PanelReviewStoppedBy;
	if (stoppedByBudget) {
		stoppedBy = 'budget';
	} else if (hasAnyGateRegression) {
		stoppedBy = 'gate-regression';
	} else if (priorActiveRuns.length > 0 && !hasNewFindings) {
		stoppedBy = 'no-new-findings';
	} else {
		stoppedBy = 'converged';
	}

	const runRecord: PanelReviewRunRecord = {
		version: 1,
		run: runId,
		change: request.change,
		...(derivedAuthor ? { derivedAuthor } : {}),
		round,
		panelSize,
		jobs: [...request.jobs],
		target: request.target,
		appDate: request.appDate,
		...(request.captures ? { captures: request.captures } : {}),
		walks: completed.map((c) => c.result.walk),
		families,
		costUsd: Number(roundCostUsd.toFixed(4)),
		status: 'active',
		createdAt: now.toISOString(),
		provisionalItems: storedProvisional,
		escalatedCards,
		findingKeys: currentFindingKeys,
	};

	// Transactional publication: record Mode 3 decision (if applicable), write escalated cards + run record;
	// roll back cards on failure, while still persisting a withdrawn cost-ledger record if publication fails.
	const writtenCardPaths: string[] = [];
	try {
		if (shouldRecordProvisional && options?.recordProvisional && derivedAuthor) {
			const primary = storedProvisional[0] as StoredProvisionalAgreement;
			const aggregateChosen: 'accept' | 'reject' = storedProvisional.some(
				(item) => item.verdict === 'reject'
			)
				? 'reject'
				: 'accept';
			const rec = await options.recordProvisional({
				items: nonConflictingCaptureItems.map((i) => i.id),
				chosen: aggregateChosen,
				reason: primary.summary,
				reviewers: primary.decidedBy.reviewers,
				split: primary.decidedBy.split,
				changeAuthor: derivedAuthor,
			});
			if (rec?.decision) {
				for (const item of storedProvisional) {
					item.decisionId = rec.decision;
				}
			}
		}
		for (const card of cardsToWrite) {
			await writeCardRecord(config.root, card);
			writtenCardPaths.push(cardFilePath(config.root, card.card));
		}
		await writePanelRun(config.root, runRecord);
	} catch (error) {
		for (const p of writtenCardPaths) {
			await unlink(p).catch(() => {});
		}
		// Preserve incurred walk cost in budget history even on publication or Mode 3 recording failure.
		await writePanelRun(config.root, {
			...runRecord,
			status: 'withdrawn',
			withdrawnAt: now.toISOString(),
			withdrawnReason:
				'Publication failed after walks completed; cost retained for budget accounting.',
			provisionalItems: [],
			escalatedCards: [],
		}).catch(() => {});
		throw error;
	}

	const nextSteps: string[] = [
		escalated.length > 0
			? `Review ${escalated.length} escalated decision card(s) with design-card-list (scope: "all") and present them to a person; do not self-approve.`
			: 'Inspect the queue with design-card-list (scope: "all") or sample provisional agreements blindly with panel-calibrate.',
	];
	if (stoppedBy === 'budget') {
		nextSteps.push(
			'Panel stopped mid-flight on budget; inspect emitted cards in design-card-list before raising budget.'
		);
	}

	return {
		run: runId,
		round,
		panelSize,
		walks: runRecord.walks,
		overlap: {
			families,
			sharedFindings,
			uniqueFindings,
		},
		provisional,
		escalated,
		stoppedBy,
		nextSteps,
		unmeasured: defaultPanelUnmeasured(includeIdentityGap),
	};
}

/**
 * Execute `panel-review` in review mode (default) or withdraw mode (`action: 'withdraw'`).
 * Serialized with `.panel-runs.lock` (shared with `panel-calibrate`) so reviews, withdrawals,
 * and calibration sampling/recording stay strictly consistent.
 */
export async function runPanelReview(
	config: LoadedConfig,
	rawRequest: PanelReviewRequest,
	options?: RunPanelReviewOptions
): Promise<PanelReviewResult> {
	const request = parsePanelReviewRequest(rawRequest);
	const now = options?.now ? options.now() : new Date();
	const lockPath = join(specimenDataDir(config.root), '.panel-runs.lock');
	await assertRealContained(config.root, lockPath, `Panel runs lock escapes root: ${lockPath}`);
	return withFileLock(lockPath, async () => {
		if (request.action === 'withdraw') {
			return runWithdrawMode(config, request, now);
		}
		return runReviewMode(config, request, options, now);
	});
}

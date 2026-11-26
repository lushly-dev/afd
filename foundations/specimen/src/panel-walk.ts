import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoadedConfig } from './config.js';
import type { SpecimenHostError } from './host.js';
import { assertWalkTargetAllowed, runBrowserWalk } from './panel-browser.js';
import {
	panelWalkRecordSchema,
	walkFindingSchema,
	walkJournalEntrySchema,
} from './panel-schema.js';
import {
	type BlindWalkJudge,
	DEFAULT_WALK_MAX_ACTIONS,
	DEFAULT_WALK_TIMEOUT_MS,
	MODALITY_TOOL_POLICIES,
	MODALITY_VALUES,
	type Modality,
	type ModalityToolbox,
	type PanelWalkDriver,
	type PanelWalkDriverResult,
	type PanelWalkRecord,
	type PanelWalkRequest,
	type PanelWalkResult,
	type PersonaDefinition,
	WALK_ID_LENGTH,
	WALK_ID_PATTERN,
	WALKS_DIR,
	type WalkFinding,
	type WalkJournalEntry,
	type WalkPairwiseComparison,
	type WalkPathMetrics,
	type WalkUnmeasuredEntry,
} from './panel-types.js';
import { parsePanelWalkRequest } from './panel-validate.js';
import {
	assertRealContained,
	assertRealFileContained,
	specimenDataDir,
	writeFileAtomic,
} from './sets.js';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error = new Error(message) as SpecimenHostError;
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

/** Raised internally by `ModalityToolbox` when an action cap or walk deadline is hit. */
export class WalkLimitError extends Error {
	readonly reason: 'action-cap' | 'timeout';
	constructor(reason: 'action-cap' | 'timeout', message: string) {
		super(message);
		this.name = 'WalkLimitError';
		this.reason = reason;
	}
}

/** Generate a 12-character lowercase Crockford base-32 walk id (`walk-<12>`). */
export function generateWalkId(): string {
	const bytes = randomBytes(WALK_ID_LENGTH);
	let body = '';
	for (let i = 0; i < WALK_ID_LENGTH; i++) {
		body += CROCKFORD[(bytes[i] ?? 0) & 31];
	}
	return `walk-${body}`;
}

/** Directory where scratch walk records are stored under `.specimen/walks/`. */
export function walksDir(root: string): string {
	return join(specimenDataDir(root), WALKS_DIR);
}

/**
 * Unconditionally validate requested tools against the modality's permitted tool table.
 * Rejects any tool outside `MODALITY_TOOL_POLICIES[modality].allowedTools` with `MODALITY_FORBIDDEN`.
 */
export function enforceModalityTools(
	modality: Modality,
	requestedTools?: readonly string[]
): readonly string[] {
	const policy = MODALITY_TOOL_POLICIES[modality];
	if (!requestedTools) {
		return policy.allowedTools;
	}
	if (requestedTools.length === 0) {
		throw typedError(
			'VALIDATION_ERROR',
			'requestedTools cannot be empty when supplied.',
			`Omit requestedTools to use all tools for '${modality}', or supply one or more permitted tools (${policy.allowedTools.join(', ')}).`
		);
	}
	const allowed = new Set(policy.allowedTools);
	const forbidden = requestedTools.filter((tool) => !allowed.has(tool));
	if (forbidden.length > 0) {
		throw typedError(
			'MODALITY_FORBIDDEN',
			`Tool(s) [${forbidden.join(', ')}] are forbidden for modality '${modality}'.`,
			`Remove forbidden tools and run with only the tools permitted for the '${modality}' modality (${policy.allowedTools.join(', ')}).`,
			{ modality, forbidden, allowed: [...policy.allowedTools] }
		);
	}
	return [...new Set(requestedTools)];
}

export interface ModalityToolboxOptions {
	maxActions?: number;
	signal?: AbortSignal;
}

/**
 * Construct a runtime-enforced modality toolbox that physically permits only the modality's
 * allowed tools, enforces `maxActions` and `signal` BEFORE executing each tool, and refuses
 * any forbidden tool call with `MODALITY_FORBIDDEN`.
 */
export function createModalityToolbox(
	modality: Modality,
	executor: (tool: string, input?: Record<string, unknown>) => Promise<unknown> = async () => ({
		ok: true,
	}),
	requestedTools?: readonly string[],
	options?: ModalityToolboxOptions
): ModalityToolbox {
	const activeTools = [...enforceModalityTools(modality, requestedTools)];
	const allowedSet = new Set(activeTools);
	const policy = MODALITY_TOOL_POLICIES[modality];
	const calls: Array<{ tool: string; input?: Record<string, unknown> }> = [];
	const maxActions = options?.maxActions;
	const signal = options?.signal;

	return {
		modality,
		allowedTools: Object.freeze(activeTools),
		viewport: { ...policy.viewport },
		showsScreenshot: policy.showsScreenshot,
		calls,
		async invoke(tool: string, input?: Record<string, unknown>): Promise<unknown> {
			if (!allowedSet.has(tool)) {
				throw typedError(
					'MODALITY_FORBIDDEN',
					`Runtime call to '${tool}' is forbidden under modality '${modality}'.`,
					`Use only tools permitted for the '${modality}' modality (${activeTools.join(', ')}).`,
					{ modality, tool, allowed: activeTools }
				);
			}
			if (signal?.aborted) {
				throw new WalkLimitError(
					'timeout',
					'Walk aborted after exceeding its wall-clock deadline.'
				);
			}
			if (maxActions !== undefined && calls.length >= maxActions) {
				throw new WalkLimitError(
					'action-cap',
					`Walk reached its action cap of ${maxActions} actions.`
				);
			}
			calls.push({ tool, ...(input === undefined ? {} : { input }) });
			return executor(tool, input);
		},
	};
}

/** Build the persona walk prompt with Phase 0 preamble, card, script (no steps), `appDate`, and ending rule. */
export function buildWalkPrompt(options: {
	persona: PersonaDefinition;
	job: string;
	script: string;
	modality: Modality;
	appDate?: string;
}): string {
	const policy = MODALITY_TOOL_POLICIES[options.modality];
	const lines: string[] = [
		'You are evaluating a running application strictly as the persona below.',
		'Use only what you perceive through your allowed tools. Do not speculate about code, DOM, or selectors.',
		'',
		`Persona: ${options.persona.name ?? options.persona.id} (${options.persona.id})`,
		`Modality: ${options.modality} (viewport ${policy.viewport.width}x${policy.viewport.height}, screenshots ${policy.showsScreenshot ? 'enabled' : 'disabled'})`,
		`Allowed tools: ${policy.allowedTools.join(', ')}`,
	];
	if (options.persona.stance) {
		lines.push(`Stance: ${options.persona.stance}`);
	}
	if (options.persona.card) {
		lines.push('', 'Persona card:', options.persona.card.trim());
	}
	if (options.appDate) {
		lines.push('', `Today in the application is ${options.appDate}.`);
	}
	lines.push(
		'',
		`Job: ${options.job}`,
		'Script:',
		options.script.trim(),
		'',
		'Report every finding as either observed (what actually happened) or hypothesis (an unverified guess).',
		'End your report with a single final line: either "Done." or "Stopped — <reason>."'
	);
	return lines.join('\n');
}

export interface ParsedWalkEnding {
	ending: 'done' | 'stopped';
	endingLine: string;
	malformed: boolean;
}

/**
 * Parse the explicit last-line ending required by Phase 0 (`Done.` or `Stopped — <reason>`).
 * Bare `Stopped` without a reason or arbitrary unmatched final lines resolve as `stopped`
 * with `malformed: true` and an explicit explanation.
 */
export function parseWalkEnding(transcript: string): ParsedWalkEnding {
	const lines = transcript
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const last = lines[lines.length - 1] ?? '';
	if (last === 'Done.' || last === 'Done') {
		return { ending: 'done', endingLine: 'Done.', malformed: false };
	}
	if (/^stopped/i.test(last)) {
		const rest = last.slice('stopped'.length).trimStart();
		let reason = '';
		if (
			rest.startsWith('—') ||
			rest.startsWith('–') ||
			rest.startsWith(':') ||
			rest.startsWith('-')
		) {
			reason = rest.slice(1).trim();
		} else if (rest.startsWith(',')) {
			const afterComma = rest.slice(1).trimStart();
			if (/^because(?:\s|$)/i.test(afterComma)) {
				reason = afterComma.slice('because'.length).trim();
			}
		}
		if (reason.length > 0) {
			return { ending: 'stopped', endingLine: last, malformed: false };
		}
	}
	return {
		ending: 'stopped',
		endingLine: last
			? `Stopped — malformed ending line (expected "Done." or "Stopped — <reason>", got "${last.slice(0, 80)}").`
			: 'Stopped — missing final ending line.',
		malformed: true,
	};
}

/**
 * Score the recorded command journal against the job's expected steps (Phase 0 `walks.md`):
 * - `failed`: any command that returned `success === false` unless `expectedRefusal === true`.
 * - `repeats`: any mutation repeating an already-seen `(command, recordId)` (when `recordId` is set)
 *   or an `undo === true` call.
 * - `outside`: any non-read-only command beyond the expected multiset of steps (including excess
 *   invocations of a command listed once when a batch was expected).
 * - `failed`, `repeats`, and `outside` are evaluated independently on each entry.
 * - `deviations = failed + repeats + outside`.
 * - `done` requires `ending === 'done'` AND (when `expectedSteps.length > 0`) every expected step
 *   satisfied in the journal.
 */
export function computeWalkPath(
	journal: readonly WalkJournalEntry[],
	expectedSteps: readonly string[],
	ending: 'done' | 'stopped'
): WalkPathMetrics {
	const remainingExpected = new Map<string, number>();
	for (const step of expectedSteps) {
		remainingExpected.set(step, (remainingExpected.get(step) ?? 0) + 1);
	}
	const remainingSatisfied = new Map(remainingExpected);
	const seenMutations = new Set<string>();
	let failed = 0;
	let repeats = 0;
	let outside = 0;

	for (const entry of journal) {
		const isReadOnly = entry.readOnly === true;
		const isFailed = !entry.success && entry.expectedRefusal !== true;
		if (isFailed) {
			failed += 1;
		}
		if (isReadOnly) {
			continue;
		}

		// Repeat accounting (independent of success/failure)
		if (entry.undo === true) {
			repeats += 1;
		} else if (entry.mutation !== false && entry.recordId !== undefined) {
			const mutKey = `${entry.command}\0${entry.recordId}`;
			if (seenMutations.has(mutKey)) {
				repeats += 1;
			} else {
				seenMutations.add(mutKey);
			}
		}

		// Outside accounting against expected multiset (independent of success/failure)
		if (expectedSteps.length > 0) {
			const left = remainingExpected.get(entry.command) ?? 0;
			if (left > 0) {
				remainingExpected.set(entry.command, left - 1);
			} else {
				outside += 1;
			}
		}

		// Completion satisfaction requires a valid non-failed execution (or expectedRefusal)
		if (!isFailed && expectedSteps.length > 0) {
			const leftSat = remainingSatisfied.get(entry.command) ?? 0;
			if (leftSat > 0) {
				remainingSatisfied.set(entry.command, leftSat - 1);
			}
		}
	}

	const allExpectedSatisfied =
		expectedSteps.length === 0 || [...remainingSatisfied.values()].every((count) => count === 0);
	const done = ending === 'done' && allExpectedSatisfied;

	return {
		done,
		failed,
		repeats,
		outside,
		deviations: failed + repeats + outside,
	};
}

interface AnonymizedWalkReport {
	label: 'Report A' | 'Report B';
	ending: 'done' | 'stopped';
	done: boolean;
	deviations: number;
	failed: number;
	repeats: number;
	outside: number;
	observedCount: number;
	hypothesisCount: number;
	blockingTroubleWeight: number;
	frictionWeight: number;
	findings: readonly WalkFinding[];
	renderedText: string;
}

const BLOCKING_TERMS = [
	'blocked',
	'unreachable',
	'intercepted',
	'clipped',
	'disappeared',
	'transparent',
	'no visible focus',
	'silent',
	'never announced',
	'omitted from screen-reader',
	'aria-hidden',
	'only responded to double-click',
	'failed',
	'cannot',
	'unable',
	'lost',
	'crash',
	'error',
	'http 4',
	'http 5',
];

const FRICTION_TERMS = [
	'overflow',
	'identical accessible name',
	'ambiguous',
	'jumped',
	'backward',
	'workaround',
	'extra',
	'confusing',
	'unclear',
	'slow',
	'repeat',
];

function classifyFindingWeight(finding: WalkFinding): { blocking: number; friction: number } {
	const text = `${finding.summary} ${finding.where}`.toLowerCase();
	const evidenceScale = finding.evidence === 'observed' ? 1 : 0.25;
	if (BLOCKING_TERMS.some((term) => text.includes(term))) {
		return { blocking: 4 * evidenceScale, friction: 0 };
	}
	if (FRICTION_TERMS.some((term) => text.includes(term))) {
		return { blocking: 0, friction: 2 * evidenceScale };
	}
	return { blocking: 0, friction: 1 * evidenceScale };
}

function anonymizeReport(
	label: 'Report A' | 'Report B',
	result: PanelWalkResult
): AnonymizedWalkReport {
	let blockingTroubleWeight = 0;
	let frictionWeight = 0;
	let observedCount = 0;
	let hypothesisCount = 0;
	for (const finding of result.findings) {
		if (finding.evidence === 'observed') observedCount += 1;
		else hypothesisCount += 1;
		const weight = classifyFindingWeight(finding);
		blockingTroubleWeight += weight.blocking;
		frictionWeight += weight.friction;
	}
	const renderedText = [
		`${label}:`,
		`Ending: ${result.ending} (completed=${result.path.done})`,
		`Path: deviations=${result.path.deviations} (failed=${result.path.failed}, repeats=${result.path.repeats}, outside=${result.path.outside})`,
		'Findings:',
		...(result.findings.length === 0
			? ['- (none)']
			: result.findings.map((f) => `- [${f.evidence}] (${f.where}) ${f.summary}`)),
	].join('\n');

	return {
		label,
		ending: result.ending,
		done: result.path.done,
		deviations: result.path.deviations,
		failed: result.path.failed,
		repeats: result.path.repeats,
		outside: result.path.outside,
		observedCount,
		hypothesisCount,
		blockingTroubleWeight,
		frictionWeight,
		findings: result.findings,
		renderedText,
	};
}

/**
 * Blind pairwise report comparison between two walks of the same job and modality.
 * Anonymizes both reports into Report A / Report B in a deterministic hash order over BOTH
 * reports so labels never leak `current`/`baseline`.
 *
 * Hierarchy of harm (Phase 0 `walks.md`):
 * 1. Failing to finish (`ending === 'stopped'` or `!path.done`) strictly dominates any completed walk.
 * 2. Observed blocking trouble > observed workaround/friction trouble > hypotheses (meaning-aware,
 *    not just raw counts).
 * 3. Path deviations (failures, outside detours, repeats).
 */
export function compareWalkReportsBlind(
	current: PanelWalkResult,
	baseline: PanelWalkResult,
	judge?: BlindWalkJudge
): WalkPairwiseComparison {
	if (current.job !== baseline.job || current.modality !== baseline.modality) {
		throw typedError(
			'VALIDATION_ERROR',
			`Baseline walk '${baseline.walk}' (${baseline.job}/${baseline.modality}) is incompatible with current walk (${current.job}/${current.modality}).`,
			'Pass a baselineWalk recorded for the same job and modality.'
		);
	}

	const normCurrent = JSON.stringify({
		ending: current.ending,
		path: current.path,
		findings: current.findings,
	});
	const normBaseline = JSON.stringify({
		ending: baseline.ending,
		path: baseline.path,
		findings: baseline.findings,
	});
	// Symmetric order-independent pair hash so Report A / Report B assignment cannot leak roles
	const pairKey = [normCurrent, normBaseline].sort().join('\0');
	const digest = createHash('sha256').update(pairKey).digest();
	const currentIsA = ((digest[0] ?? 0) & 1) === 0;

	const reportA = anonymizeReport('Report A', currentIsA ? current : baseline);
	const reportB = anonymizeReport('Report B', currentIsA ? baseline : current);

	if (judge) {
		const judged = judge({ reportA: reportA.renderedText, reportB: reportB.renderedText });
		const worse: 'current' | 'baseline' | 'same' =
			judged.worse === 'same'
				? 'same'
				: judged.worse === 'A'
					? currentIsA
						? 'current'
						: 'baseline'
					: currentIsA
						? 'baseline'
						: 'current';
		return {
			baselineWalk: baseline.walk,
			method: 'blind-pairwise-report',
			worse,
			why: judged.why.trim() || 'Blind pairwise judge completed comparison.',
		};
	}

	const compareTier = (a: number, b: number): 'A' | 'B' | null => {
		if (a === b) return null;
		return a > b ? 'A' : 'B';
	};

	const incompleteA = reportA.ending === 'stopped' || !reportA.done ? 1 : 0;
	const incompleteB = reportB.ending === 'stopped' || !reportB.done ? 1 : 0;

	let worseSlot: 'A' | 'B' | 'same' = 'same';
	let primaryReason = '';

	const tier1 = compareTier(incompleteA, incompleteB);
	if (tier1) {
		worseSlot = tier1;
		primaryReason = 'failed to complete the job while the other walk completed';
	} else {
		const harmA = reportA.blockingTroubleWeight * 10 + reportA.frictionWeight;
		const harmB = reportB.blockingTroubleWeight * 10 + reportB.frictionWeight;
		const tier2 = compareTier(harmA, harmB);
		if (tier2) {
			worseSlot = tier2;
			const w = tier2 === 'A' ? reportA : reportB;
			const b = tier2 === 'A' ? reportB : reportA;
			if (w.blockingTroubleWeight > b.blockingTroubleWeight) {
				primaryReason = 'reported more severe blocking trouble for the user';
			} else if (w.observedCount > b.observedCount) {
				primaryReason = `reported more observed trouble (${w.observedCount} vs ${b.observedCount})`;
			} else {
				primaryReason = 'reported heavier workaround friction in its findings';
			}
		} else {
			const tier3 = compareTier(reportA.deviations, reportB.deviations);
			if (tier3) {
				worseSlot = tier3;
				const w = tier3 === 'A' ? reportA : reportB;
				const b = tier3 === 'A' ? reportB : reportA;
				primaryReason = `recorded more path deviations (${w.deviations} vs ${b.deviations})`;
			} else {
				const tier4 = compareTier(reportA.failed, reportB.failed);
				if (tier4) {
					worseSlot = tier4;
					const w = tier4 === 'A' ? reportA : reportB;
					const b = tier4 === 'A' ? reportB : reportA;
					primaryReason = `incurred more failed commands (${w.failed} vs ${b.failed})`;
				} else {
					const tier5 = compareTier(reportA.hypothesisCount, reportB.hypothesisCount);
					if (tier5) {
						worseSlot = tier5;
						const w = tier5 === 'A' ? reportA : reportB;
						const b = tier5 === 'A' ? reportB : reportA;
						primaryReason = `raised more unresolved hypotheses (${w.hypothesisCount} vs ${b.hypothesisCount})`;
					}
				}
			}
		}
	}

	if (worseSlot === 'same') {
		return {
			baselineWalk: baseline.walk,
			method: 'blind-pairwise-report',
			worse: 'same',
			why: 'Both anonymized walk reports matched in completion, observed trouble severity, and path deviations.',
		};
	}

	const worseReport = worseSlot === 'A' ? reportA : reportB;
	const betterReport = worseSlot === 'A' ? reportB : reportA;
	const details: string[] = [primaryReason];
	if (worseReport.deviations > betterReport.deviations && !primaryReason.includes('deviations')) {
		details.push(
			`had more path deviations (${worseReport.deviations} vs ${betterReport.deviations})`
		);
	}
	if (worseReport.failed > betterReport.failed && !primaryReason.includes('failed')) {
		details.push(`had more failed commands (${worseReport.failed} vs ${betterReport.failed})`);
	}
	const worse: 'current' | 'baseline' =
		worseSlot === 'A' ? (currentIsA ? 'current' : 'baseline') : currentIsA ? 'baseline' : 'current';
	const subject = worse === 'current' ? 'current walk' : 'baseline walk';

	return {
		baselineWalk: baseline.walk,
		method: 'blind-pairwise-report',
		worse,
		why: `Blind pairwise comparison judged the ${subject} worse because it ${details.join(' and ')}.`,
	};
}

/** Read and schema-validate a persisted walk record from `.specimen/walks/<walk>.json`. */
export async function readWalkRecord(
	root: string,
	walkId: string
): Promise<PanelWalkRecord | undefined> {
	if (!WALK_ID_PATTERN.test(walkId)) {
		return undefined;
	}
	const dir = walksDir(root);
	const filePath = join(dir, `${walkId}.json`);
	if (!existsSync(filePath)) return undefined;
	await assertRealFileContained(root, filePath, `Walk record escapes workspace root: ${walkId}`);
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(filePath, 'utf8'));
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Stored walk record '${walkId}' contains invalid JSON.`,
			'Remove or regenerate the corrupt walk record before referencing it as baselineWalk.'
		);
	}
	const parsed = panelWalkRecordSchema.safeParse(raw);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Stored walk record '${walkId}' failed schema validation: ${parsed.error.message}`,
			'Regenerate the baseline walk with panel-walk before referencing it as baselineWalk.'
		);
	}
	return parsed.data;
}

/** Atomically persist a walk record under `.specimen/walks/<walk>.json` with ID and symlink checks. */
export async function writeWalkRecord(root: string, record: PanelWalkRecord): Promise<string> {
	if (!WALK_ID_PATTERN.test(record.walk)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid walk id '${record.walk}'.`,
			'Walk ids must match /^walk-[0-9a-hjkmnp-tv-z]{12}$/.'
		);
	}
	const dir = walksDir(root);
	const filePath = join(dir, `${record.walk}.json`);
	await assertRealContained(root, dir, `Walk directory escapes workspace root: ${dir}`);
	await mkdir(dir, { recursive: true });
	await assertRealContained(
		root,
		filePath,
		`Walk record path escapes workspace root: ${record.walk}`
	);
	await writeFileAtomic(filePath, `${JSON.stringify(record, null, '\t')}\n`);
	return filePath;
}

interface ResolvedWalkJob {
	job: string;
	script: string;
	expectedSteps: string[];
}

function unquoteYamlScalar(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Extract participant-facing script metadata from a `.scenario.yaml`/`.yaml` file WITHOUT
 * exposing `steps:`, `command:`, `input:`, or `expect:` blocks to the persona prompt.
 */
function parseYamlScenarioForWalk(
	raw: string,
	fallbackJob: string
): { script: string; expectedSteps: string[] } {
	const expectedSteps: string[] = [];
	const lines = raw.split(/\r?\n/);

	let inSteps = false;
	let stepsIndent = 0;
	let name: string | undefined;
	let description: string | undefined;
	let scriptText: string | undefined;
	let startingState: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;

		if (inSteps) {
			if (indent <= stepsIndent && !trimmed.startsWith('-')) {
				inSteps = false;
			} else {
				const cmdMatch = /^(?:-\s+)?command\s*:\s*["']?([a-zA-Z0-9._:-]+)["']?/.exec(trimmed);
				if (cmdMatch?.[1]) {
					expectedSteps.push(cmdMatch[1]);
				}
				continue;
			}
		}

		if (indent === 0 && /^steps\s*:/i.test(trimmed)) {
			inSteps = true;
			stepsIndent = indent;
			continue;
		}

		const readScalarOrBlock = (key: string): string | undefined => {
			const match = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(trimmed);
			if (!match) return undefined;
			const value = (match[1] ?? '').trim();
			if (value === '|' || value === '>' || value === '|-' || value === '>-') {
				const blockLines: string[] = [];
				let blockIndent: number | undefined;
				while (i + 1 < lines.length) {
					const nextLine = lines[i + 1] ?? '';
					if (nextLine.trim() === '') {
						blockLines.push('');
						i += 1;
						continue;
					}
					const nextIndent = nextLine.length - nextLine.trimStart().length;
					if (nextIndent <= indent) break;
					blockIndent ??= nextIndent;
					blockLines.push(nextLine.slice(Math.min(blockIndent, nextIndent)));
					i += 1;
				}
				return blockLines.join('\n').trim();
			}
			return unquoteYamlScalar(value);
		};

		if (indent === 0) {
			name ??= readScalarOrBlock('name');
			description ??= readScalarOrBlock('description');
			scriptText ??= readScalarOrBlock('script');
			startingState ??= readScalarOrBlock('startingState');
		}
	}

	const parts: string[] = [];
	if (scriptText) parts.push(scriptText);
	else if (description) parts.push(description);
	else if (name) parts.push(`Complete the '${name}' job.`);
	else parts.push(`Complete the '${fallbackJob}' job.`);
	if (startingState) parts.push(`Starting state: ${startingState}`);

	return {
		script: parts.join('\n\n'),
		expectedSteps,
	};
}

function isSafeSingleSegmentId(id: string): boolean {
	return (
		id.length > 0 &&
		!id.includes('/') &&
		!id.includes('\\') &&
		!id.includes('..') &&
		!id.includes('\0')
	);
}

export async function resolveWalkJob(
	config: LoadedConfig,
	jobId: string
): Promise<ResolvedWalkJob> {
	const panelJobs = config.config.panel?.jobs ?? [];
	const configuredEntry = config.entries.find((e) => e.id === jobId && e.job !== undefined);

	const scenariosDir = config.config.panel?.scenariosDir
		? resolve(dirname(config.file), config.config.panel.scenariosDir)
		: join(config.root, 'scenarios');

	if (existsSync(scenariosDir)) {
		await assertRealContained(
			config.root,
			scenariosDir,
			`Configured panel.scenariosDir escapes workspace root: ${scenariosDir}`
		);
	}

	const candidateFiles: string[] = [];
	if (configuredEntry?.job?.scenario) {
		candidateFiles.push(resolve(dirname(config.file), configuredEntry.job.scenario));
	}
	if (isSafeSingleSegmentId(jobId)) {
		candidateFiles.push(
			join(scenariosDir, `${jobId}.scenario.yaml`),
			join(scenariosDir, `${jobId}.yaml`),
			join(scenariosDir, `${jobId}.json`)
		);
	}

	for (const candidate of candidateFiles) {
		if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
		await assertRealFileContained(
			config.root,
			candidate,
			`Scenario file escapes workspace root: ${candidate}`
		);
		const raw = await readFile(candidate, 'utf8');
		if (candidate.endsWith('.json')) {
			let parsed: {
				script?: string;
				description?: string;
				name?: string;
				steps?: Array<{ command?: string }>;
			};
			try {
				parsed = JSON.parse(raw) as typeof parsed;
			} catch {
				throw typedError(
					'VALIDATION_ERROR',
					`Scenario file '${candidate}' contains invalid JSON.`,
					'Fix the JSON syntax in the scenario file before running panel-walk.'
				);
			}
			const expectedSteps = Array.isArray(parsed.steps)
				? parsed.steps.map((s) => (typeof s?.command === 'string' ? s.command : '')).filter(Boolean)
				: [];
			return {
				job: jobId,
				script:
					parsed.script ??
					parsed.description ??
					(parsed.name ? `Complete the '${parsed.name}' job.` : `Complete the '${jobId}' job.`),
				expectedSteps,
			};
		}
		const extracted = parseYamlScenarioForWalk(raw, jobId);
		return {
			job: jobId,
			script: extracted.script,
			expectedSteps: extracted.expectedSteps,
		};
	}

	if (panelJobs.includes(jobId)) {
		return {
			job: jobId,
			script: `Complete the '${jobId}' job against the running application.`,
			expectedSteps: [],
		};
	}

	throw typedError(
		'JOB_NOT_FOUND',
		`Job '${jobId}' was not found in panel.jobs, job specimens, or scenarios/.`,
		'Define the job in specimen.config.json (panel.jobs or specimens[].job) or add a matching scenario file under scenarios/.'
	);
}

async function resolveWalkPersona(
	config: LoadedConfig,
	personaId: string,
	requestedModality: Modality
): Promise<PersonaDefinition> {
	const configured = config.config.panel?.personas?.find((p) => p.id === personaId);
	if (configured) {
		if (configured.modality !== requestedModality) {
			throw typedError(
				'MODALITY_FORBIDDEN',
				`Persona '${personaId}' is declared with modality '${configured.modality}', not '${requestedModality}'.`,
				`Run panel-walk with modality '${configured.modality}' for persona '${personaId}', or pick a persona matching '${requestedModality}'.`,
				{ persona: personaId, declaredModality: configured.modality, requestedModality }
			);
		}
		return configured;
	}

	if (isSafeSingleSegmentId(personaId)) {
		const personasDir = join(config.root, 'personas');
		if (existsSync(personasDir)) {
			await assertRealContained(
				config.root,
				personasDir,
				`Personas directory escapes workspace root: ${personasDir}`
			);
		}
		const mdPath = join(personasDir, `${personaId}.md`);
		const jsonPath = join(personasDir, `${personaId}.json`);

		if (existsSync(jsonPath) && statSync(jsonPath).isFile()) {
			await assertRealFileContained(
				config.root,
				jsonPath,
				`Persona file escapes workspace root: ${jsonPath}`
			);
			let parsed: Partial<PersonaDefinition>;
			try {
				parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as Partial<PersonaDefinition>;
			} catch {
				throw typedError(
					'VALIDATION_ERROR',
					`Persona file '${jsonPath}' contains invalid JSON.`,
					'Fix the JSON syntax in the persona file before running panel-walk.'
				);
			}
			if (parsed.modality !== undefined) {
				if (!(MODALITY_VALUES as readonly string[]).includes(parsed.modality)) {
					throw typedError(
						'VALIDATION_ERROR',
						`Persona file '${jsonPath}' has invalid modality '${String(parsed.modality)}'.`,
						`Set modality to one of ${MODALITY_VALUES.join(', ')}.`
					);
				}
				if (parsed.modality !== requestedModality) {
					throw typedError(
						'MODALITY_FORBIDDEN',
						`Persona '${personaId}' is declared with modality '${parsed.modality}', not '${requestedModality}'.`,
						`Run panel-walk with modality '${parsed.modality}' for persona '${personaId}'.`
					);
				}
			}
			return {
				id: personaId,
				modality: parsed.modality ?? requestedModality,
				...(parsed.name ? { name: parsed.name } : {}),
				...(parsed.stance ? { stance: parsed.stance } : {}),
				...(parsed.card ? { card: parsed.card } : {}),
			};
		}

		if (existsSync(mdPath) && statSync(mdPath).isFile()) {
			await assertRealFileContained(
				config.root,
				mdPath,
				`Persona card escapes workspace root: ${mdPath}`
			);
			const card = await readFile(mdPath, 'utf8');
			const modalityHeader = /^\s*modality\s*:\s*([a-z-]+)\s*$/im.exec(card);
			if (modalityHeader?.[1]) {
				const declared = modalityHeader[1].toLowerCase();
				if (
					(MODALITY_VALUES as readonly string[]).includes(declared) &&
					declared !== requestedModality
				) {
					throw typedError(
						'MODALITY_FORBIDDEN',
						`Persona card '${personaId}.md' declares modality '${declared}', not '${requestedModality}'.`,
						`Run panel-walk with modality '${declared}' for persona '${personaId}'.`
					);
				}
			}
			return { id: personaId, modality: requestedModality, card };
		}
	}

	throw typedError(
		'PERSONA_NOT_FOUND',
		`Persona '${personaId}' was not found in panel.personas or personas/.`,
		'Define the persona in specimen.config.json (panel.personas) or add personas/<id>.md.'
	);
}

async function loadConfiguredDriver(config: LoadedConfig): Promise<PanelWalkDriver | undefined> {
	const driverRel = config.config.panel?.driver;
	if (!driverRel) return undefined;
	const base = dirname(config.file);
	const candidate = resolve(base, driverRel);
	if (!existsSync(candidate) || !statSync(candidate).isFile()) {
		throw typedError(
			'VALIDATION_ERROR',
			`Configured panel.driver not found: '${driverRel}'.`,
			'Verify panel.driver in specimen.config.json points to a readable ESM module.'
		);
	}
	await assertRealFileContained(
		config.root,
		candidate,
		`Configured panel.driver '${driverRel}' escapes the workspace root.`
	);
	const resolved = await realpath(candidate);
	const loaded = (await import(pathToFileURL(resolved).href)) as { default?: unknown };
	if (typeof loaded.default !== 'function') {
		throw typedError(
			'VALIDATION_ERROR',
			`Configured panel.driver '${driverRel}' must export a default async function.`,
			'Export a PanelWalkDriver function as default from the panel.driver module.'
		);
	}
	return loaded.default as PanelWalkDriver;
}

function buildWalkUnmeasured(appDate?: string): WalkUnmeasuredEntry[] {
	const entries: WalkUnmeasuredEntry[] = [
		{
			area: 'forced-colors',
			reason: 'Forced-colors (high-contrast OS mode) rendering is not evaluated by persona walks.',
			addToMeasure: 'Run specimen-themes or a high-contrast Specimen capture check on this screen.',
		},
		{
			area: 'motion',
			reason:
				'Reduced-motion animations and transition comfort are not evaluated by persona walks.',
			addToMeasure:
				'Run a Specimen capture with reducedMotion: reduce to verify settled transitions.',
		},
	];
	if (appDate === undefined) {
		entries.push({
			area: 'fixed-clock',
			reason:
				'appDate was omitted; screen dates may be judged against the wall clock instead of the fixture date.',
			addToMeasure:
				'Pass appDate (YYYY-MM-DD) aligned with the application fixture clock to panel-walk.',
		});
	}
	return entries;
}

function validateDriverResult(raw: unknown): PanelWalkDriverResult {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw typedError(
			'VALIDATION_ERROR',
			'Walk driver returned a non-object result.',
			'Ensure the panel walk driver returns { transcript, findings, actions?, journal? }.'
		);
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.transcript !== 'string') {
		throw typedError(
			'VALIDATION_ERROR',
			'Walk driver result.transcript must be a string.',
			'Return a string transcript ending with "Done." or "Stopped — <reason>.".'
		);
	}
	if (
		obj.actions !== undefined &&
		(typeof obj.actions !== 'number' || !Number.isSafeInteger(obj.actions) || obj.actions < 0)
	) {
		throw typedError(
			'VALIDATION_ERROR',
			'Walk driver result.actions must be a non-negative integer.',
			'Return a non-negative integer action count or omit actions to use toolbox call count.'
		);
	}
	if (!Array.isArray(obj.findings)) {
		throw typedError(
			'VALIDATION_ERROR',
			'Walk driver result.findings must be an array.',
			'Return an array of { summary, evidence, where } findings.'
		);
	}
	const findings: WalkFinding[] = obj.findings.map((item, idx) => {
		const parsed = walkFindingSchema.safeParse(item);
		if (!parsed.success) {
			throw typedError(
				'VALIDATION_ERROR',
				`Walk driver result.findings[${idx}] is invalid: ${parsed.error.message}`,
				'Ensure each finding has non-empty summary, evidence ("observed" | "hypothesis"), and where.'
			);
		}
		return parsed.data;
	});
	let journal: WalkJournalEntry[] | undefined;
	if (obj.journal !== undefined) {
		if (!Array.isArray(obj.journal)) {
			throw typedError(
				'VALIDATION_ERROR',
				'Walk driver result.journal must be an array.',
				'Return an array of journal entries or omit journal.'
			);
		}
		journal = obj.journal.map((item, idx) => {
			const parsed = walkJournalEntrySchema.safeParse(item);
			if (!parsed.success) {
				throw typedError(
					'VALIDATION_ERROR',
					`Walk driver result.journal[${idx}] is invalid: ${parsed.error.message}`,
					'Ensure each journal entry has a non-empty command and boolean success.'
				);
			}
			return parsed.data;
		});
	}
	return {
		transcript: obj.transcript,
		...(obj.actions === undefined ? {} : { actions: obj.actions }),
		...(journal === undefined ? {} : { journal }),
		findings,
	};
}

export interface RunPanelWalkOptions {
	driver?: PanelWalkDriver;
	/** Maximum wall-clock duration in milliseconds (defaults to 30 minutes per Phase 0). */
	timeoutMs?: number;
	/** Optional external abort signal (e.g., bench shutdown). */
	signal?: AbortSignal;
	/** Optional blind judge for pairwise report comparison. */
	blindJudge?: BlindWalkJudge;
}

/**
 * Run one modality-enforced persona walk against a running application, persist the scratch walk
 * record under `.specimen/walks/<walk>.json`, and optionally run blind pairwise comparison against
 * a prior `baselineWalk`.
 */
export async function runPanelWalk(
	config: LoadedConfig,
	rawRequest: PanelWalkRequest,
	options?: RunPanelWalkOptions
): Promise<PanelWalkResult> {
	const request = parsePanelWalkRequest(rawRequest);
	const allowedOrigins = config.config.network?.allow ?? [];
	assertWalkTargetAllowed(request.target, allowedOrigins);

	// 1. Pre-flight modality tool enforcement (unconditional).
	const allowedTools = [...enforceModalityTools(request.modality, request.requestedTools)];

	// 2. Resolve job and persona (strictly refusing unknown ids and symlink escapes).
	const resolvedJob = await resolveWalkJob(config, request.job);
	const resolvedPersona = await resolveWalkPersona(config, request.persona, request.modality);

	// 3. Resolve and validate baseline walk before running if supplied.
	let baselineRecord: PanelWalkRecord | undefined;
	if (request.baselineWalk !== undefined) {
		baselineRecord = await readWalkRecord(config.root, request.baselineWalk);
		if (!baselineRecord) {
			throw typedError(
				'WALK_NOT_FOUND',
				`Baseline walk '${request.baselineWalk}' was not found under .specimen/walks/.`,
				'Run panel-walk first to produce a baseline walk id, then pass it as baselineWalk.'
			);
		}
		if (
			baselineRecord.result.job !== resolvedJob.job ||
			baselineRecord.result.modality !== request.modality
		) {
			throw typedError(
				'VALIDATION_ERROR',
				`Baseline walk '${request.baselineWalk}' (${baselineRecord.result.job}/${baselineRecord.result.modality}) does not match (${resolvedJob.job}/${request.modality}).`,
				'Pass a baselineWalk recorded for the same job and modality.'
			);
		}
	}

	const maxActions = request.maxActions ?? DEFAULT_WALK_MAX_ACTIONS;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_WALK_TIMEOUT_MS;
	const prompt = buildWalkPrompt({
		persona: resolvedPersona,
		job: resolvedJob.job,
		script: resolvedJob.script,
		modality: request.modality,
		...(request.appDate === undefined ? {} : { appDate: request.appDate }),
	});

	const controller = new AbortController();
	const onExternalAbort = () => controller.abort();
	if (options?.signal) {
		if (options.signal.aborted) controller.abort();
		else options.signal.addEventListener('abort', onExternalAbort, { once: true });
	}
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	const customDriver = options?.driver ?? (await loadConfiguredDriver(config));
	const toolbox = createModalityToolbox(request.modality, undefined, request.requestedTools, {
		maxActions,
		signal: controller.signal,
	});
	let activeToolbox = toolbox;

	let driverResult: PanelWalkDriverResult;
	let driverPromise: Promise<PanelWalkDriverResult> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			const rejectAbort = () =>
				reject(
					new WalkLimitError(
						'timeout',
						timedOut ? `Walk exceeded the ${timeoutMs}ms wall-clock deadline.` : 'Walk was aborted.'
					)
				);
			if (controller.signal.aborted) {
				rejectAbort();
				return;
			}
			controller.signal.addEventListener('abort', rejectAbort, { once: true });
		});

		driverPromise = controller.signal.aborted
			? undefined
			: customDriver
				? customDriver({
						job: resolvedJob.job,
						script: resolvedJob.script,
						expectedSteps: resolvedJob.expectedSteps,
						persona: resolvedPersona,
						modality: request.modality,
						target: request.target,
						...(request.appDate === undefined ? {} : { appDate: request.appDate }),
						maxActions,
						prompt,
						toolbox,
						signal: controller.signal,
						allowedOrigins,
					})
				: runBrowserWalk(
						{
							job: resolvedJob.job,
							script: resolvedJob.script,
							expectedSteps: resolvedJob.expectedSteps,
							persona: resolvedPersona,
							modality: request.modality,
							target: request.target,
							...(request.appDate === undefined ? {} : { appDate: request.appDate }),
							maxActions,
							prompt,
							toolbox,
							signal: controller.signal,
							allowedOrigins,
						},
						(executor) => {
							activeToolbox = createModalityToolbox(
								request.modality,
								executor,
								request.requestedTools,
								{
									maxActions,
									signal: controller.signal,
								}
							);
							return activeToolbox;
						}
					);
		// Prevent unhandled rejection if timeoutPromise wins the race while driverPromise rejects on close
		void driverPromise?.catch(() => {});

		const rawResult = driverPromise
			? await Promise.race([driverPromise, timeoutPromise])
			: await timeoutPromise;
		driverResult = validateDriverResult(rawResult);
	} catch (error) {
		if (error instanceof WalkLimitError) {
			driverResult = {
				transcript: `Walk for ${resolvedJob.job} (${request.modality})\nStopped — ${error.message}`,
				actions: activeToolbox.calls.length,
				journal: [],
				findings: [
					{
						summary: error.message,
						evidence: 'observed',
						where: `${resolvedJob.job} (${error.reason})`,
					},
				],
			};
		} else {
			throw error;
		}
	} finally {
		clearTimeout(timer);
		options?.signal?.removeEventListener('abort', onExternalAbort);
	}

	const reportedActions = driverResult.actions ?? activeToolbox.calls.length;
	let { ending, endingLine } = parseWalkEnding(driverResult.transcript);
	let transcript = driverResult.transcript;
	const findings = [...driverResult.findings];
	if (reportedActions > maxActions) {
		ending = 'stopped';
		endingLine = `Stopped — driver reported ${reportedActions} actions, exceeding maxActions cap (${maxActions}).`;
		transcript = `${transcript}\n${endingLine}`;
		findings.push({
			summary: `Walk exceeded maxActions cap (${reportedActions} > ${maxActions}).`,
			evidence: 'observed',
			where: `${resolvedJob.job} (action-cap)`,
		});
	}

	const journal = driverResult.journal ?? [];
	const path = computeWalkPath(journal, resolvedJob.expectedSteps, ending);
	const walk = generateWalkId();

	const baseResult: PanelWalkResult = {
		walk,
		job: resolvedJob.job,
		persona: resolvedPersona.id,
		modality: request.modality,
		ending,
		actions: reportedActions,
		path,
		findings,
		unmeasured: buildWalkUnmeasured(request.appDate),
	};

	const comparison: WalkPairwiseComparison | undefined = baselineRecord
		? compareWalkReportsBlind(baseResult, baselineRecord.result, options?.blindJudge)
		: undefined;

	const result: PanelWalkResult = {
		...baseResult,
		...(comparison === undefined ? {} : { comparison }),
	};

	const policy = MODALITY_TOOL_POLICIES[request.modality];
	const record: PanelWalkRecord = {
		version: 1,
		walk,
		recordedUtc: new Date().toISOString(),
		target: request.target,
		...(request.appDate === undefined ? {} : { appDate: request.appDate }),
		viewport: { ...policy.viewport },
		allowedTools,
		prompt,
		endingLine,
		transcript,
		journal,
		expectedSteps: resolvedJob.expectedSteps,
		result,
	};
	await writeWalkRecord(config.root, record);

	return result;
}

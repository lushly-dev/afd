import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { LoadedConfig } from './config.js';
import { compareCodeUnits, readDecisionRecord, typedError } from './decisions-store.js';
import type { UnmeasuredEntry } from './design-types.js';
import type {
	DesignObserveMetrics,
	DesignObserveMetricsSummary,
	DesignObserveRequest,
	DesignObserveResult,
	DesignObserveStatus,
} from './observe-types.js';
import { parseDesignObserveRequest } from './observe-validate.js';
import { resolveWalkJob } from './panel-walk.js';
import { readAllReleases } from './releases.js';

const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const RATE_EPSILON = 1e-9;

export const OBSERVE_CAUSATION_NOTE =
	'Movement after release is observation, not proof of causation; command journals correlate with release timing and cannot isolate concurrent product, seasonal, or traffic changes.';

interface RawEvent {
	command?: string;
	success?: boolean;
	ok?: boolean;
	hasError: boolean;
	expectedFailure: boolean;
	outside: boolean;
	timestampMs?: number;
	hasInvalidTimestamp: boolean;
}

interface NormalizedRun {
	id: string;
	job?: string;
	minTimestampMs?: number;
	maxTimestampMs?: number;
	hasUndatedEvent: boolean;
	hasInvalidTimestamp: boolean;
	completed?: boolean;
	status?: string;
	explicitUnexpectedFailures?: number;
	explicitRepeats?: number;
	explicitOutsideSteps?: number;
	events: RawEvent[];
}

function journalNotFoundError(journalPath: string, reason?: string) {
	return typedError(
		'JOURNAL_NOT_FOUND',
		`Command journal not found or unreadable: ${journalPath}${reason ? ` (${reason})` : ''}`,
		'Provide a readable AFD command journal path inside the workspace (for example journals/post-release.jsonl).',
		{ journal: journalPath }
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function nonNegativeInt(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function hasTruthyError(value: unknown): boolean {
	if (value === undefined || value === null || value === false) return false;
	if (typeof value === 'string') return value.trim().length > 0;
	return true;
}

const TIMESTAMP_KEYS = ['timestamp', 'ts', 'at', 'completedAt', 'startedAt'] as const;

function parseTimestampField(raw: unknown): { ms?: number; present: boolean; invalid: boolean } {
	if (raw === undefined || raw === null) return { present: false, invalid: false };
	if (typeof raw !== 'string') return { present: true, invalid: true };
	const trimmed = raw.trim();
	if (!trimmed) return { present: true, invalid: true };
	const ms = Date.parse(trimmed);
	return Number.isFinite(ms)
		? { ms, present: true, invalid: false }
		: { present: true, invalid: true };
}

function extractTimestamps(obj: Record<string, unknown>): {
	values: number[];
	hasInvalid: boolean;
} {
	const values: number[] = [];
	let hasInvalid = false;
	for (const key of TIMESTAMP_KEYS) {
		if (Object.hasOwn(obj, key)) {
			const parsed = parseTimestampField(obj[key]);
			if (parsed.invalid) hasInvalid = true;
			if (parsed.ms !== undefined) values.push(parsed.ms);
		}
	}
	return { values, hasInvalid };
}

function isContainedPath(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function readJournalFile(root: string, rawPath: string): Promise<Record<string, unknown>[]> {
	if (rawPath.includes('\0')) {
		throw typedError(
			'VALIDATION_ERROR',
			'Journal path must not contain NUL bytes.',
			'Pass a valid workspace-relative path to the command journal.'
		);
	}
	const resolvedRoot = resolve(root);
	const candidate = resolve(resolvedRoot, rawPath);
	if (!isContainedPath(resolvedRoot, candidate)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Journal path escapes workspace root: ${rawPath}`,
			'Place command journals inside the workspace root before running design-observe.',
			{ journal: rawPath }
		);
	}

	let realRoot: string;
	let realTarget: string;
	try {
		realRoot = await realpath(resolvedRoot);
		realTarget = await realpath(candidate);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'ELOOP') {
			throw journalNotFoundError(rawPath, code);
		}
		throw error;
	}

	if (!isContainedPath(realRoot, realTarget)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Journal file escapes workspace root: ${rawPath}`,
			'Place command journals inside the workspace root (without symlinks pointing outside) before running design-observe.',
			{ journal: rawPath }
		);
	}

	const openFlags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(realTarget, openFlags);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'ELOOP') {
			throw journalNotFoundError(rawPath, code);
		}
		throw error;
	}

	let text: string;
	try {
		const info = await handle.stat();
		if (!info.isFile()) {
			throw journalNotFoundError(rawPath, 'not a regular file');
		}
		if (info.size > MAX_JOURNAL_BYTES) {
			throw typedError(
				'VALIDATION_ERROR',
				`Journal file '${rawPath}' exceeds the ${MAX_JOURNAL_BYTES}-byte safety limit.`,
				'Split or filter the command journal before passing it to design-observe.',
				{ journal: rawPath, bytes: info.size, maxBytes: MAX_JOURNAL_BYTES }
			);
		}
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		const chunkBuf = Buffer.allocUnsafe(64 * 1024);
		while (true) {
			const { bytesRead } = await handle.read(chunkBuf, 0, chunkBuf.length, null);
			if (bytesRead === 0) break;
			totalBytes += bytesRead;
			if (totalBytes > MAX_JOURNAL_BYTES) {
				throw typedError(
					'VALIDATION_ERROR',
					`Journal file '${rawPath}' exceeds the ${MAX_JOURNAL_BYTES}-byte safety limit.`,
					'Split or filter the command journal before passing it to design-observe.',
					{ journal: rawPath, bytes: totalBytes, maxBytes: MAX_JOURNAL_BYTES }
				);
			}
			chunks.push(Buffer.from(chunkBuf.subarray(0, bytesRead)));
		}
		text = Buffer.concat(chunks, totalBytes).toString('utf8');
	} finally {
		await handle.close();
	}

	const trimmed = text.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith('[')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (error) {
			throw typedError(
				'VALIDATION_ERROR',
				`Journal '${rawPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				'Provide a valid JSONL or JSON array command journal.',
				{ journal: rawPath }
			);
		}
		if (!Array.isArray(parsed) || !parsed.every(isPlainObject)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Journal '${rawPath}' JSON array must contain only object entries.`,
				'Provide a valid JSONL or JSON array command journal.',
				{ journal: rawPath }
			);
		}
		return parsed;
	}

	const rows: Record<string, unknown>[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]?.trim() ?? '';
		if (!line) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw typedError(
				'VALIDATION_ERROR',
				`Journal '${rawPath}' line ${i + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				'Fix malformed JSONL lines in the command journal and re-run design-observe.',
				{ journal: rawPath, line: i + 1 }
			);
		}
		if (!isPlainObject(parsed)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Journal '${rawPath}' line ${i + 1} must be a JSON object.`,
				'Ensure every non-empty line in the command journal is a JSON object.',
				{ journal: rawPath, line: i + 1 }
			);
		}
		rows.push(parsed);
	}
	return rows;
}

function parseRawEvent(obj: Record<string, unknown>): RawEvent {
	// Support canonical AFD JournalEntry (`result: { success, error }`) as well as flat journal rows.
	const resultObj = isPlainObject(obj.result) ? obj.result : undefined;
	const success =
		typeof resultObj?.success === 'boolean'
			? resultObj.success
			: typeof obj.success === 'boolean'
				? obj.success
				: undefined;
	const ok = typeof obj.ok === 'boolean' ? obj.ok : undefined;
	const hasError =
		resultObj !== undefined
			? hasTruthyError(resultObj.error) || resultObj.success === false
			: hasTruthyError(obj.error);
	const expectedFailure =
		obj.expectedFailure === true ||
		obj.expectedRefusal === true ||
		obj.expected === true ||
		resultObj?.expectedFailure === true ||
		resultObj?.expectedRefusal === true;
	const ts = extractTimestamps(obj);
	return {
		command: nonEmptyString(obj.command) ?? nonEmptyString(obj.cmd),
		success,
		ok,
		hasError,
		expectedFailure,
		outside: obj.outside === true,
		timestampMs: ts.values[0],
		hasInvalidTimestamp: ts.hasInvalid,
	};
}

function extractRunKey(row: Record<string, unknown>): string | undefined {
	const ctx = isPlainObject(row.context) ? row.context : undefined;
	return (
		nonEmptyString(row.runId) ??
		nonEmptyString(row.sessionId) ??
		nonEmptyString(row.session) ??
		nonEmptyString(row.traceId) ??
		(ctx
			? (nonEmptyString(ctx.runId) ?? nonEmptyString(ctx.sessionId) ?? nonEmptyString(ctx.jobRunId))
			: undefined)
	);
}

function extractJob(row: Record<string, unknown>): string | undefined {
	const ctx = isPlainObject(row.context) ? row.context : undefined;
	return (
		nonEmptyString(row.job) ??
		nonEmptyString(row.scenario) ??
		(ctx ? (nonEmptyString(ctx.job) ?? nonEmptyString(ctx.scenario)) : undefined)
	);
}

function hasSummarySignals(row: Record<string, unknown>): boolean {
	return (
		Array.isArray(row.steps) ||
		Array.isArray(row.commands) ||
		typeof row.completed === 'boolean' ||
		typeof row.done === 'boolean' ||
		nonEmptyString(row.status) !== undefined ||
		nonEmptyString(row.outcome) !== undefined ||
		nonNegativeInt(row.unexpectedFailures) !== undefined ||
		nonNegativeInt(row.repeats) !== undefined ||
		nonNegativeInt(row.outsideSteps) !== undefined
	);
}

function groupRowsIntoRuns(rows: Record<string, unknown>[]): NormalizedRun[] {
	const runsById = new Map<string, NormalizedRun>();
	const orderedRuns: NormalizedRun[] = [];
	let syntheticCounter = 0;

	const recordTimestampValues = (run: NormalizedRun, values: number[], hasInvalid: boolean) => {
		if (hasInvalid) run.hasInvalidTimestamp = true;
		for (const ms of values) {
			if (run.minTimestampMs === undefined || ms < run.minTimestampMs) run.minTimestampMs = ms;
			if (run.maxTimestampMs === undefined || ms > run.maxTimestampMs) run.maxTimestampMs = ms;
		}
	};

	const applySummaryFields = (run: NormalizedRun, row: Record<string, unknown>) => {
		if (typeof row.completed === 'boolean') run.completed = row.completed;
		else if (typeof row.done === 'boolean') run.completed = row.done;
		const statusVal = nonEmptyString(row.status) ?? nonEmptyString(row.outcome);
		if (statusVal) run.status = statusVal.toLowerCase();
		const expFail = nonNegativeInt(row.unexpectedFailures);
		if (expFail !== undefined) run.explicitUnexpectedFailures = expFail;
		const expRep = nonNegativeInt(row.repeats);
		if (expRep !== undefined) run.explicitRepeats = expRep;
		const expOut = nonNegativeInt(row.outsideSteps);
		if (expOut !== undefined) run.explicitOutsideSteps = expOut;
	};

	for (const row of rows) {
		const explicitSteps = Array.isArray(row.steps)
			? row.steps.filter(isPlainObject)
			: Array.isArray(row.commands)
				? row.commands.filter(isPlainObject)
				: undefined;
		const cmdName = nonEmptyString(row.command) ?? nonEmptyString(row.cmd);
		const runKey = extractRunKey(row);
		const job = extractJob(row);
		const rowTs = extractTimestamps(row);

		// Ignore non-run metadata/heartbeat/lifecycle rows that carry neither a command nor summary fields.
		if (cmdName === undefined && !hasSummarySignals(row)) {
			continue;
		}

		const isSummaryRow = explicitSteps !== undefined || cmdName === undefined;
		if (isSummaryRow) {
			let run = runKey ? runsById.get(runKey) : undefined;
			if (!run) {
				syntheticCounter += 1;
				const id = runKey ?? `__summary_${syntheticCounter}`;
				run = {
					id,
					...(job ? { job } : {}),
					hasUndatedEvent: false,
					hasInvalidTimestamp: false,
					events: [],
				};
				if (runKey) runsById.set(runKey, run);
				orderedRuns.push(run);
			}
			if (!run.job && job) run.job = job;
			applySummaryFields(run, row);
			recordTimestampValues(run, rowTs.values, rowTs.hasInvalid);
			const events = (explicitSteps ?? []).map(parseRawEvent);
			for (const ev of events) {
				run.events.push(ev);
				if (ev.hasInvalidTimestamp) run.hasInvalidTimestamp = true;
				if (ev.timestampMs !== undefined) {
					recordTimestampValues(run, [ev.timestampMs], false);
				} else if (rowTs.values.length === 0) {
					run.hasUndatedEvent = true;
				}
			}
			if (events.length === 0 && rowTs.values.length === 0) {
				run.hasUndatedEvent = true;
			}
			continue;
		}

		// Command-event row: group by runKey if present, else treat each row as a 1-step run.
		const effectiveKey = runKey ?? `__event_${++syntheticCounter}`;
		let run = runKey ? runsById.get(effectiveKey) : undefined;
		if (!run) {
			run = {
				id: effectiveKey,
				...(job ? { job } : {}),
				hasUndatedEvent: false,
				hasInvalidTimestamp: false,
				events: [],
			};
			if (runKey) runsById.set(effectiveKey, run);
			orderedRuns.push(run);
		}
		if (!run.job && job) run.job = job;
		applySummaryFields(run, row);
		const ev = parseRawEvent(row);
		run.events.push(ev);
		if (rowTs.values.length === 0) {
			run.hasUndatedEvent = true;
		}
		recordTimestampValues(run, rowTs.values, rowTs.hasInvalid);
	}

	return orderedRuns;
}

function summarizeRuns(
	runs: readonly NormalizedRun[],
	expectedSteps: readonly string[]
): DesignObserveMetricsSummary {
	if (runs.length === 0) {
		return {
			runs: 0,
			completionRate: 0,
			unexpectedFailures: 0,
			repeats: 0,
			outsideSteps: 0,
		};
	}
	const expectedSet = new Set(expectedSteps);
	let completedRuns = 0;
	let totalUnexpectedFailures = 0;
	let totalRepeats = 0;
	let totalOutsideSteps = 0;

	for (const run of runs) {
		let unexpectedFailures = run.explicitUnexpectedFailures ?? 0;
		let repeats = run.explicitRepeats ?? 0;
		let outsideSteps = run.explicitOutsideSteps ?? 0;
		const executedCommands = new Set<string>();

		// Always scan events so `executedCommands` is populated even when explicit counters are supplied.
		let prevCommand: string | undefined;
		for (const ev of run.events) {
			const isFailure =
				(ev.success === false || ev.ok === false || (ev.hasError && ev.success !== true)) &&
				!ev.expectedFailure;
			if (run.explicitUnexpectedFailures === undefined && isFailure) {
				unexpectedFailures += 1;
			}
			if (ev.command) {
				if (run.explicitRepeats === undefined && prevCommand === ev.command) {
					repeats += 1;
				}
				if (
					run.explicitOutsideSteps === undefined &&
					(ev.outside === true || (expectedSet.size > 0 && !expectedSet.has(ev.command)))
				) {
					outsideSteps += 1;
				}
				if (!isFailure) {
					executedCommands.add(ev.command);
				}
				prevCommand = ev.command;
			} else if (run.explicitOutsideSteps === undefined && ev.outside === true) {
				outsideSteps += 1;
			}
		}

		let isCompleted: boolean;
		if (run.completed !== undefined) {
			isCompleted = run.completed;
		} else if (run.status !== undefined) {
			isCompleted =
				run.status === 'done' ||
				run.status === 'completed' ||
				run.status === 'passed' ||
				run.status === 'success';
		} else {
			const hitExpected =
				expectedSteps.length === 0 || expectedSteps.every((step) => executedCommands.has(step));
			isCompleted = run.events.length > 0 && unexpectedFailures === 0 && hitExpected;
		}

		if (isCompleted) completedRuns += 1;
		totalUnexpectedFailures += unexpectedFailures;
		totalRepeats += repeats;
		totalOutsideSteps += outsideSteps;
	}

	return {
		runs: runs.length,
		completionRate: Number((completedRuns / runs.length).toFixed(4)),
		unexpectedFailures: totalUnexpectedFailures,
		repeats: totalRepeats,
		outsideSteps: totalOutsideSteps,
	};
}

interface JobFilterOutcome {
	runs: NormalizedRun[];
	attribution: 'unfiltered' | 'explicit-job-tag' | 'inferred-from-commands' | 'unattributable';
}

function filterRunsForJob(
	runs: readonly NormalizedRun[],
	targetJob: string | undefined,
	expectedSteps: readonly string[]
): JobFilterOutcome {
	if (!targetJob) {
		return { runs: [...runs], attribution: 'unfiltered' };
	}
	const anyTaggedWithJob = runs.some((r) => r.job !== undefined);
	if (anyTaggedWithJob) {
		return {
			runs: runs.filter((r) => r.job === targetJob),
			attribution: 'explicit-job-tag',
		};
	}
	if (runs.length === 0) {
		return { runs: [], attribution: 'explicit-job-tag' };
	}
	if (expectedSteps.length > 0) {
		const expectedSet = new Set(expectedSteps);
		const matched = runs.filter((r) =>
			r.events.some((ev) => ev.command !== undefined && expectedSet.has(ev.command))
		);
		return { runs: matched, attribution: 'inferred-from-commands' };
	}
	return { runs: [], attribution: 'unattributable' };
}

function classifyObserveStatus(
	after: DesignObserveMetricsSummary,
	before: DesignObserveMetricsSummary | undefined
): DesignObserveStatus {
	if (after.runs === 0 || !before || before.runs === 0) return 'insufficient-data';

	if (after.completionRate < before.completionRate - RATE_EPSILON) return 'regressed';
	if (after.completionRate > before.completionRate + RATE_EPSILON) return 'improved';

	const afterFailRate = after.unexpectedFailures / after.runs;
	const beforeFailRate = before.unexpectedFailures / before.runs;
	const afterRepeatRate = after.repeats / after.runs;
	const beforeRepeatRate = before.repeats / before.runs;
	const afterOutsideRate = after.outsideSteps / after.runs;
	const beforeOutsideRate = before.outsideSteps / before.runs;

	const improvedSignal =
		afterFailRate < beforeFailRate - RATE_EPSILON ||
		afterRepeatRate < beforeRepeatRate - RATE_EPSILON ||
		afterOutsideRate < beforeOutsideRate - RATE_EPSILON;
	const regressedSignal =
		afterFailRate > beforeFailRate + RATE_EPSILON ||
		afterRepeatRate > beforeRepeatRate + RATE_EPSILON ||
		afterOutsideRate > beforeOutsideRate + RATE_EPSILON;

	if (improvedSignal && !regressedSignal) return 'improved';
	if (regressedSignal && !improvedSignal) return 'regressed';
	if (improvedSignal && regressedSignal) {
		const afterTrouble = afterFailRate + afterRepeatRate + afterOutsideRate;
		const beforeTrouble = beforeFailRate + beforeRepeatRate + beforeOutsideRate;
		if (afterTrouble < beforeTrouble - RATE_EPSILON) return 'improved';
		if (afterTrouble > beforeTrouble + RATE_EPSILON) return 'regressed';
	}
	return 'unchanged';
}

function buildObserveUnmeasured(options: {
	beforeJournalSupplied: boolean;
	beforeRuns: number;
	jobAttribution: JobFilterOutcome['attribution'];
	targetJob?: string;
}): UnmeasuredEntry[] {
	const list: UnmeasuredEntry[] = [
		{
			area: 'perception-only-trouble',
			reason:
				'Command journals cannot observe visual confusion, layout friction, readability issues, or hesitation that still finishes the same command sequence.',
			addToMeasure: 'Run panel-walk or panel-review with visual and assistive-tech personas.',
		},
	];
	if (!options.beforeJournalSupplied) {
		list.push({
			area: 'pre-release-baseline',
			reason:
				'No beforeJournal was supplied, so post-release metrics could not be compared against pre-release behaviour.',
			addToMeasure:
				'Pass beforeJournal with a pre-release command journal to measure movement before and after release.',
		});
	} else if (options.beforeRuns === 0) {
		list.push({
			area: 'pre-release-baseline',
			reason:
				'The supplied beforeJournal contained zero qualifying pre-release runs on or before releasedAt.',
			addToMeasure:
				'Provide a beforeJournal containing timestamped pre-release runs for the target job on or before releasedAt.',
		});
	}
	if (options.jobAttribution === 'inferred-from-commands' && options.targetJob) {
		list.push({
			area: 'job-attribution',
			reason: `Journal entries did not carry explicit job tags; runs were attributed to '${options.targetJob}' by command overlap with its scenario steps.`,
			addToMeasure:
				'Include a journaled job context field on command journal entries for exact job attribution.',
		});
	} else if (options.jobAttribution === 'unattributable' && options.targetJob) {
		list.push({
			area: 'job-attribution',
			reason: `Journal entries had no job tags and no scenario for '${options.targetJob}' was available to identify target runs, so untagged traffic was not attributed.`,
			addToMeasure:
				'Tag journal entries with job (or context.job) or define the job scenario under scenarios/.',
		});
	}
	return list;
}

/**
 * Observe post-release AFD command journals against an approved, released decision's `meantToFix`
 * target and `releasedAt` timestamp, optionally comparing against `beforeJournal`.
 */
export async function runDesignObserve(
	configOrRoot: LoadedConfig | string,
	rawRequest: DesignObserveRequest
): Promise<DesignObserveResult> {
	const root = typeof configOrRoot === 'string' ? configOrRoot : configOrRoot.root;
	const config = typeof configOrRoot === 'string' ? undefined : configOrRoot;
	const request = parseDesignObserveRequest(rawRequest);

	// 1. Verify decision exists (`DECISION_NOT_FOUND` -> suggestion names `decision-list`)
	const record = await readDecisionRecord(root, request.decision);

	// 2. Verify decision was released (`NOT_RELEASED` -> suggestion names `design-release`)
	const releases = await readAllReleases(root);
	const matchingReleases = releases
		.filter((rel) => rel.decisions.includes(record.id))
		.sort((a, b) => {
			const diff = Date.parse(a.releasedAt) - Date.parse(b.releasedAt);
			return diff !== 0 ? diff : compareCodeUnits(a.release, b.release);
		});
	const release = matchingReleases[0];
	if (!release) {
		throw typedError(
			'NOT_RELEASED',
			`Decision '${record.id}' has not been recorded in any release manifest.`,
			'Record a release containing this decision with design-release before running design-observe.',
			{ decision: record.id }
		);
	}
	const releasedMs = Date.parse(release.releasedAt);
	if (!Number.isFinite(releasedMs)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Release '${release.release}' has an invalid releasedAt timestamp: ${release.releasedAt}`,
			'Inspect the release manifest under specimens/releases/.'
		);
	}

	const meantToFix = record.kind === 'card' ? record.meantToFix : undefined;

	// 3. Optionally resolve expected scenario steps for meantToFix.job (non-fatal if absent)
	let expectedSteps: string[] = [];
	if (meantToFix?.job && config) {
		try {
			const jobSpec = await resolveWalkJob(config, meantToFix.job);
			expectedSteps = jobSpec.expectedSteps;
		} catch {
			expectedSteps = [];
		}
	}

	// 4. Read, timestamp-filter, and then job-filter post-release journal
	const postRows = await readJournalFile(root, request.journal);
	const postPeriodRuns = groupRowsIntoRuns(postRows).filter(
		(run) =>
			!run.hasUndatedEvent &&
			!run.hasInvalidTimestamp &&
			run.minTimestampMs !== undefined &&
			run.minTimestampMs > releasedMs
	);
	const postJobFiltered = filterRunsForJob(postPeriodRuns, meantToFix?.job, expectedSteps);
	const afterSummary = summarizeRuns(postJobFiltered.runs, expectedSteps);

	let beforeSummary: DesignObserveMetricsSummary | undefined;
	if (request.beforeJournal !== undefined) {
		const beforeRows = await readJournalFile(root, request.beforeJournal);
		const beforePeriodRuns = groupRowsIntoRuns(beforeRows).filter(
			(run) =>
				!run.hasUndatedEvent &&
				!run.hasInvalidTimestamp &&
				run.maxTimestampMs !== undefined &&
				run.maxTimestampMs <= releasedMs
		);
		const beforeJobFiltered = filterRunsForJob(beforePeriodRuns, meantToFix?.job, expectedSteps);
		beforeSummary = summarizeRuns(beforeJobFiltered.runs, expectedSteps);
	}

	const status = classifyObserveStatus(afterSummary, beforeSummary);
	const metrics: DesignObserveMetrics = {
		...afterSummary,
		...(beforeSummary !== undefined ? { before: beforeSummary } : {}),
	};

	return {
		decision: record.id,
		releasedAt: release.releasedAt,
		...(meantToFix !== undefined ? { meantToFix } : {}),
		status,
		metrics,
		note: OBSERVE_CAUSATION_NOTE,
		unmeasured: buildObserveUnmeasured({
			beforeJournalSupplied: request.beforeJournal !== undefined,
			beforeRuns: beforeSummary?.runs ?? 0,
			jobAttribution: postJobFiltered.attribution,
			targetJob: meantToFix?.job,
		}),
	};
}

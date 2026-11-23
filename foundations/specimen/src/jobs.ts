import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RANDOM_SEED } from './baseline.js';
import { isValidIsoClock } from './browser/clock-parse.js';
import { diffObservations } from './diff.js';
import type { SpecimenHostError } from './host.js';
import { type JobSource, parseJobScenarioWithSources } from './job-source.js';
import type { JobDriverResult } from './plugin.js';
import { type WriteCaptureSetItem, writeCaptureSet } from './sets.js';
import type {
	CaptureSetManifest,
	CheckpointsRun,
	JobCaptureSummary,
	JobPin,
	JobRun,
	JobScenario,
	JobStepResult,
	Observation,
	PinnedBaseline,
	ResolvedJobCapture,
	SpecimenContext,
	SpecimenEntry,
	ValidationIssue,
	ValidationReport,
	ValidationTarget,
} from './types.js';

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error: SpecimenHostError = new Error(message);
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

/** Validate a calendar-valid ISO-8601 clock pin string (`YYYY-MM-DDTHH:MM:SS[.sss](Z|±HH:MM)`). */
export function isValidClockPin(value: string): boolean {
	return isValidIsoClock(value);
}

/** Build the reported `pinned` block from an optional `JobPin`. */
export function resolvePinnedBaseline(pin?: JobPin): PinnedBaseline {
	const clock = pin?.clock;
	if (clock !== undefined && !isValidClockPin(clock)) {
		throw new Error(
			`Invalid pin.clock '${clock}': expected an ISO-8601 timestamp with timezone, such as 2026-03-02T09:00:00Z.`
		);
	}
	return {
		clock: clock ?? 'real',
		random: 'seeded',
	};
}

/**
 * Match every `entry.job.captures` item against `scenario.steps` by exact `description`,
 * returning captures sorted in 1-based step order with `<id>/<step>` keys.
 */
export function resolveJobCapturePlan(
	entry: SpecimenEntry,
	scenario: JobScenario
): ResolvedJobCapture[] {
	if (!entry.job) {
		throw typedError(
			'NOT_A_JOB',
			`Specimen '${entry.id}' is not a job specimen.`,
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.',
			{ id: entry.id }
		);
	}
	const resolved: ResolvedJobCapture[] = [];
	const seenSteps = new Set<number>();
	for (const capture of entry.job.captures) {
		const matches = scenario.steps.filter((step) => step.description === capture.after);
		if (matches.length === 0) {
			throw typedError(
				'CAPTURE_STEP_UNKNOWN',
				`Capture '${capture.name}' on '${entry.id}' references step description "${capture.after}", which matches no step in ${entry.job.scenario}.`,
				'Run specimen-validate; name the step by its exact description, or rewrite the entry with specimen-job-create.',
				{ id: entry.id, capture: capture.name, after: capture.after }
			);
		}
		if (matches.length > 1) {
			const stepNumbers = matches.map((m) => m.step);
			throw typedError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Capture '${capture.name}' on '${entry.id}' references step description "${capture.after}", which matches ${matches.length} steps (${stepNumbers.join(', ')}) in ${entry.job.scenario}.`,
				'Give each captured step a unique description in the scenario file, then run specimen-validate.',
				{ id: entry.id, capture: capture.name, after: capture.after, steps: stepNumbers }
			);
		}
		const matched = matches[0] as JobScenario['steps'][number];
		if (seenSteps.has(matched.step)) {
			throw typedError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Multiple captures on '${entry.id}' target step ${matched.step} ("${capture.after}").`,
				'Declare at most one capture point per scenario step.',
				{ id: entry.id, step: matched.step }
			);
		}
		seenSteps.add(matched.step);
		resolved.push({
			after: capture.after,
			name: capture.name,
			step: matched.step,
			key: `${entry.id}/${matched.step}`,
			before: capture.before ? [...capture.before] : [],
		});
	}
	return resolved.sort((a, b) => a.step - b.step);
}

/**
 * Compare two consecutive marked captures in the same run using `specimen-diff`'s structured
 * channels, aligning checkpoint name and actionMode (e.g. `mount` `'none'` vs `'real-input'`)
 * so consecutive checkpoints in the same run compare cleanly while preserving original manifests.
 */
export function isObservationUnchanged(previous: Observation, current: Observation): boolean {
	const alignedCurrent: Observation = {
		...current,
		manifest: {
			...current.manifest,
			checkpoint: {
				...current.manifest.checkpoint,
				name: previous.manifest.checkpoint.name,
				actionMode: previous.manifest.checkpoint.actionMode,
			},
		},
	};
	const diff = diffObservations(previous, alignedCurrent);
	return diff.status === 'no-change-observed';
}

export interface CheckpointCaptureInput {
	key: string;
	name: string;
	step: number;
	observation: Observation;
	screenshotSource: string | null;
}

export interface FinalizeCheckpointsOptions {
	root: string;
	id: string;
	context: SpecimenContext;
	axe: boolean;
	pin?: JobPin;
	label?: string;
	revision: string | null;
	dirty: boolean | null;
	captures: readonly CheckpointCaptureInput[];
}

/**
 * Finalize a native multi-checkpoint render: detect `unchanged` against the previous marked
 * capture in the same run, persist a content-addressed Design Decisions capture set keyed
 * `<id>/<step>`, and return the compact `CheckpointsRun`.
 */
export async function finalizeCheckpointsRun(
	options: FinalizeCheckpointsOptions
): Promise<CheckpointsRun> {
	const pinned = resolvePinnedBaseline(options.pin);
	const ordered = [...options.captures].sort((a, b) => a.step - b.step);
	const writeItems: WriteCaptureSetItem[] = [];
	const summaries: Omit<JobCaptureSummary, 'screenshot'>[] = [];
	let previous: { obs: Observation; name: string; step: number } | null = null;

	for (const capture of ordered) {
		let status: 'captured' | 'unchanged' = 'captured';
		let reason: string | undefined;
		if (previous && isObservationUnchanged(previous.obs, capture.observation)) {
			status = 'unchanged';
			reason = `Screen did not change since previous capture "${previous.name}" (step ${previous.step}).`;
		}
		previous = { obs: capture.observation, name: capture.name, step: capture.step };
		writeItems.push({
			key: capture.key,
			id: options.id,
			status: 'captured',
			observation: capture.observation,
			screenshotSource: capture.screenshotSource,
			checkpoint: capture.name,
			step: capture.step,
		});
		summaries.push({
			key: capture.key,
			name: capture.name,
			step: capture.step,
			status,
			...(reason !== undefined ? { reason } : {}),
		});
	}

	const firstObs = ordered[0]?.observation;
	const checkpoint: CaptureSetManifest['checkpoint'] = firstObs
		? {
				name: firstObs.manifest.checkpoint.name,
				actionMode: firstObs.manifest.checkpoint.actionMode,
				baseline: firstObs.manifest.checkpoint.baseline,
			}
		: {
				name: 'checkpoints',
				actionMode: 'real-input',
				baseline: {
					clock: pinned.clock === 'real' ? 'real' : { pinned: pinned.clock },
					random: { source: 'seeded', seed: RANDOM_SEED },
					storage: 'empty',
				},
			};
	const browser = firstObs
		? { name: firstObs.manifest.browser.name, version: firstObs.manifest.browser.version }
		: null;

	const { manifest, run } = await writeCaptureSet(options.root, {
		kind: 'capture',
		context: options.context,
		checkpoint,
		browser,
		axe: options.axe,
		revision: options.revision,
		dirty: options.dirty,
		...(options.label !== undefined ? { label: options.label } : {}),
		entries: writeItems,
		skipped: { jobs: 0, gates: 0 },
	});

	const captures: JobCaptureSummary[] = summaries.map((summary) => ({
		...summary,
		screenshot: manifest.captures[summary.key]?.screenshot ?? null,
	}));

	return {
		set: run.set,
		label: run.label,
		id: options.id,
		revision: run.revision,
		dirty: run.dirty,
		pinned,
		captures,
		counts: run.counts,
	};
}

export interface FinalizeJobRunOptions {
	root: string;
	entry: SpecimenEntry;
	scenario: JobScenario;
	capturePlan: readonly ResolvedJobCapture[];
	driverResult: JobDriverResult;
	/** Raw observations captured by the host during the single page pass, keyed by `<id>/<step>`. */
	capturedByKey: ReadonlyMap<string, { observation: Observation; screenshotSource: string | null }>;
	context: SpecimenContext;
	axe: boolean;
	pin?: JobPin;
	label?: string;
	revision: string | null;
	dirty: boolean | null;
}

/**
 * Finalize a job run:
 * - Enforces no capture after any failed step (even under `continueOnFailure`), recording
 *   `not-taken` in the run result and `unavailable` in the capture set manifest.
 * - Marks a capture equal to the previous marked capture in the same run as `unchanged`
 *   (first marked capture is always `captured`).
 * - Attaches `manifest.job` metadata and persists a Design Decisions capture set keyed `<id>/<step>`.
 */
export async function finalizeJobRun(options: FinalizeJobRunOptions): Promise<JobRun> {
	if (!options.entry.job) {
		throw typedError(
			'NOT_A_JOB',
			`Specimen '${options.entry.id}' is not a job specimen.`,
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.',
			{ id: options.entry.id }
		);
	}
	const pinned = resolvePinnedBaseline(options.pin ?? options.entry.job.pin);
	const planByStep = new Map<number, ResolvedJobCapture>(
		options.capturePlan.map((cap) => [cap.step, cap])
	);
	const outcomeByStep = new Map<number, JobDriverResult['steps'][number]>();
	for (const stepOutcome of options.driverResult.steps) {
		if (outcomeByStep.has(stepOutcome.step)) {
			throw typedError(
				'JOB_SCENARIO_INVALID',
				`Job driver returned duplicate outcome for step ${stepOutcome.step}.`,
				'Ensure the job driver reports at most one outcome per 1-based step number.',
				{ step: stepOutcome.step }
			);
		}
		outcomeByStep.set(stepOutcome.step, stepOutcome);
	}

	let firstFailedStep: number | null = null;
	let previousCaptured: { obs: Observation; name: string; step: number } | null = null;
	const steps: JobStepResult[] = [];
	const captureSummaries: Omit<JobCaptureSummary, 'screenshot'>[] = [];
	const writeItems: WriteCaptureSetItem[] = [];
	let firstObs: Observation | undefined;

	for (const scenarioStep of options.scenario.steps) {
		const outcome = outcomeByStep.get(scenarioStep.step);
		const stepStatus: JobStepResult['status'] =
			outcome?.status ?? (firstFailedStep !== null ? 'skipped' : 'failed');
		if (stepStatus === 'failed' && firstFailedStep === null) {
			firstFailedStep = scenarioStep.step;
		}
		const description = outcome?.description ?? scenarioStep.description;
		const command = outcome?.command ?? scenarioStep.command;
		const plan = planByStep.get(scenarioStep.step);

		if (!plan) {
			steps.push({
				step: scenarioStep.step,
				...(description !== undefined ? { description } : {}),
				...(command !== undefined ? { command } : {}),
				status: stepStatus,
				...(outcome?.error !== undefined ? { error: outcome.error } : {}),
			});
			continue;
		}

		const rawCaptured = options.capturedByKey.get(plan.key);
		const failedEarlier = firstFailedStep !== null && firstFailedStep < scenarioStep.step;
		const failedNow = stepStatus !== 'passed' || firstFailedStep !== null;

		if (failedNow || !rawCaptured) {
			// Enforce no capture after any failed step (even under continueOnFailure).
			if (rawCaptured?.screenshotSource) {
				await rm(rawCaptured.screenshotSource, { force: true });
			}
			const reason = failedEarlier
				? `Step ${firstFailedStep} failed earlier; capture not taken.`
				: stepStatus === 'failed'
					? `Step ${scenarioStep.step} failed; capture not taken.`
					: firstFailedStep !== null
						? `Step ${firstFailedStep} failed; capture not taken.`
						: `Step ${scenarioStep.step} did not produce a capture; capture not taken.`;
			writeItems.push({
				key: plan.key,
				id: options.entry.id,
				status: 'unavailable',
				reason,
				checkpoint: plan.name,
				step: plan.step,
				job: options.scenario.job,
			});
			const stepCapture = {
				key: plan.key,
				name: plan.name,
				status: 'not-taken' as const,
				reason,
				...(outcome?.actions !== undefined ? { actions: outcome.actions } : {}),
			};
			steps.push({
				step: scenarioStep.step,
				...(description !== undefined ? { description } : {}),
				...(command !== undefined ? { command } : {}),
				status: stepStatus,
				...(outcome?.error !== undefined ? { error: outcome.error } : {}),
				capture: stepCapture,
			});
			captureSummaries.push({
				key: plan.key,
				name: plan.name,
				step: plan.step,
				status: 'not-taken',
				reason,
			});
			continue;
		}

		const stampedObs: Observation = {
			...rawCaptured.observation,
			manifest: {
				...rawCaptured.observation.manifest,
				job: {
					name: options.scenario.job,
					step: plan.step,
					description: description ?? plan.after,
				},
			},
		};
		firstObs ??= stampedObs;

		let captureStatus: 'captured' | 'unchanged' = 'captured';
		let unchangedReason: string | undefined;
		if (previousCaptured && isObservationUnchanged(previousCaptured.obs, stampedObs)) {
			captureStatus = 'unchanged';
			unchangedReason = `Screen did not change since previous capture "${previousCaptured.name}" (step ${previousCaptured.step}).`;
		}
		previousCaptured = { obs: stampedObs, name: plan.name, step: plan.step };

		writeItems.push({
			key: plan.key,
			id: options.entry.id,
			status: 'captured',
			observation: stampedObs,
			screenshotSource: rawCaptured.screenshotSource,
			checkpoint: plan.name,
			step: plan.step,
			job: options.scenario.job,
		});
		const actionsCount = outcome?.actions ?? plan.before.length;
		const stepCapture = {
			key: plan.key,
			name: plan.name,
			status: captureStatus,
			...(unchangedReason !== undefined ? { reason: unchangedReason } : {}),
			...(actionsCount > 0 ? { actions: actionsCount } : {}),
		};
		steps.push({
			step: scenarioStep.step,
			...(description !== undefined ? { description } : {}),
			...(command !== undefined ? { command } : {}),
			status: stepStatus,
			...(outcome?.error !== undefined ? { error: outcome.error } : {}),
			capture: stepCapture,
		});
		captureSummaries.push({
			key: plan.key,
			name: plan.name,
			step: plan.step,
			status: captureStatus,
			...(unchangedReason !== undefined ? { reason: unchangedReason } : {}),
		});
	}

	const checkpoint: CaptureSetManifest['checkpoint'] = firstObs
		? {
				name: firstObs.manifest.checkpoint.name,
				actionMode: firstObs.manifest.checkpoint.actionMode,
				baseline: firstObs.manifest.checkpoint.baseline,
			}
		: {
				name: options.capturePlan[0]?.name ?? 'job',
				actionMode: 'real-input',
				baseline: {
					clock: pinned.clock === 'real' ? 'real' : { pinned: pinned.clock },
					random: { source: 'seeded', seed: RANDOM_SEED },
					storage: 'empty',
				},
			};
	const browser = firstObs
		? { name: firstObs.manifest.browser.name, version: firstObs.manifest.browser.version }
		: null;

	const { manifest, run } = await writeCaptureSet(options.root, {
		kind: 'job',
		context: options.context,
		checkpoint,
		browser,
		axe: options.axe,
		revision: options.revision,
		dirty: options.dirty,
		...(options.label !== undefined ? { label: options.label } : {}),
		entries: writeItems,
		skipped: { jobs: 0, gates: 0 },
	});

	const captures: JobCaptureSummary[] = captureSummaries.map((summary) => ({
		...summary,
		screenshot: manifest.captures[summary.key]?.screenshot ?? null,
	}));

	const status: 'passed' | 'failed' =
		firstFailedStep !== null || options.driverResult.status === 'failed' ? 'failed' : 'passed';

	return {
		set: run.set,
		label: run.label,
		id: options.entry.id,
		job: options.scenario.job,
		scenario: options.entry.job.scenario,
		status,
		pinned,
		steps,
		captures,
		counts: run.counts,
	};
}

export interface CheckedJobEntry {
	id: string;
	module: string;
	scenario: string;
}

export interface JobValidationResult {
	checked: number;
	entries: CheckedJobEntry[];
	issues: ValidationIssue[];
}

function sameValidationFile(left: string, right: string, root: string): boolean {
	const normalize = (value: string) => resolve(root, value).replace(/\\/g, '/').toLowerCase();
	return normalize(left) === normalize(right);
}

/** Static validation for job entries using configured Node-side `JobSource` plugins. */
export async function validateJobEntries(
	entries: readonly SpecimenEntry[],
	sources: readonly JobSource[],
	root: string,
	base: string,
	target?: ValidationTarget
): Promise<JobValidationResult> {
	const jobEntries = entries.filter(
		(entry) => entry.job !== undefined && (!target?.id || entry.id === target.id)
	);
	if (jobEntries.length === 0) return { checked: 0, entries: [], issues: [] };
	const checkedEntries: CheckedJobEntry[] = [];
	const issues: ValidationIssue[] = [];
	for (const entry of jobEntries) {
		const scenarioPath = entry.job?.scenario ?? '';
		checkedEntries.push({
			id: entry.id,
			module: resolve(base, entry.module),
			scenario: resolve(base, scenarioPath),
		});
		if (sources.length === 0) {
			issues.push({
				severity: 'deferred',
				code: 'RUNNER_MISSING',
				message: `Job specimen '${entry.id}' cannot validate scenario '${scenarioPath}' without a configured jobSources plugin.`,
				suggestion:
					'Add a jobSources plugin (such as @lushly-dev/specimen-afd-runner) to specimen.config.json.',
				id: entry.id,
				importPath: scenarioPath,
				field: 'job.scenario',
			});
			continue;
		}
		let scenario: JobScenario;
		try {
			scenario = await parseJobScenarioWithSources(sources, { root, base, entry });
		} catch (error) {
			const structured = error as SpecimenHostError;
			const knownCodes = new Set([
				'RUNNER_MISSING',
				'NOT_A_JOB',
				'JOB_SCENARIO_INVALID',
				'CAPTURE_STEP_UNKNOWN',
				'CAPTURE_STEP_AMBIGUOUS',
				'STEP_HAS_NO_DESCRIPTION',
			]);
			issues.push({
				severity: 'error',
				code:
					typeof structured.code === 'string' && knownCodes.has(structured.code)
						? structured.code
						: 'JOB_SCENARIO_INVALID',
				message: error instanceof Error ? error.message : String(error),
				suggestion:
					typeof structured.suggestion === 'string' && structured.suggestion
						? structured.suggestion
						: `Check '${scenarioPath}' and fix any syntax or schema errors.`,
				id: entry.id,
				importPath: scenarioPath,
				field: 'job.scenario',
			});
			continue;
		}
		try {
			resolveJobCapturePlan(entry, scenario);
		} catch (error) {
			const structured = error as SpecimenHostError;
			issues.push({
				severity: 'error',
				code:
					typeof structured.code === 'string' && structured.code
						? structured.code
						: 'CAPTURE_STEP_UNKNOWN',
				message: error instanceof Error ? error.message : String(error),
				suggestion:
					typeof structured.suggestion === 'string' && structured.suggestion
						? structured.suggestion
						: 'Name each capture by the exact description of a step in the scenario.',
				id: entry.id,
				importPath: scenarioPath,
				field: 'job.captures',
			});
		}
	}
	return { checked: checkedEntries.length, entries: checkedEntries, issues };
}

/** Merge precomputed job validation issues into a synchronous `ValidationReport`. */
export function withJobValidation(
	report: ValidationReport,
	jobValidation: JobValidationResult | undefined,
	target?: ValidationTarget,
	root = ''
): ValidationReport {
	if (!jobValidation || jobValidation.checked === 0) return report;
	const matchesEntry = (entry: CheckedJobEntry): boolean => {
		if (target?.id !== undefined && entry.id !== target.id) return false;
		if (target?.file !== undefined) {
			return (
				sameValidationFile(entry.module, target.file, root) ||
				sameValidationFile(entry.scenario, target.file, root)
			);
		}
		return true;
	};
	const matchedEntries = jobValidation.entries.filter(matchesEntry);
	const matchedIds = new Set(matchedEntries.map((entry) => entry.id));
	const filtered = jobValidation.issues.filter((issue) =>
		issue.id ? matchedIds.has(issue.id) : target?.id === undefined && target?.file === undefined
	);
	if (matchedEntries.length === 0 && filtered.length === 0) return report;
	const issues = [...report.issues, ...filtered];
	return {
		...report,
		valid: report.valid && !filtered.some((issue) => issue.severity === 'error'),
		checked: report.checked + matchedEntries.length,
		issues,
	};
}

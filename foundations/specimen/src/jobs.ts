import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { RANDOM_SEED } from './baseline.js';
import { isValidIsoClock } from './browser/clock-parse.js';
import { diffObservations } from './diff.js';
import type { SpecimenHostError } from './host.js';
import { type JobSource, parseJobScenarioWithSources } from './job-source.js';
import type { JobDriverResult } from './plugin.js';
import {
	nearestSpecimenIds,
	readCaptureSetManifest,
	readSetCapture,
	resolveCaptureSetId,
	type WriteCaptureSetItem,
	writeCaptureSet,
} from './sets.js';
import type {
	A11yReport,
	A11yRequest,
	A11yRun,
	CaptureSetEntry,
	CaptureSetManifest,
	CheckpointsRun,
	JobCapturePoint,
	JobCaptureSelection,
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

const JOB_CAPTURE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function compareCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

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

/** Convert a step description into a deterministic kebab-case capture checkpoint slug. */
export function slugifyStepDescription(description: string, fallbackStep?: number): string {
	const slug = description
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 128)
		.replace(/-+$/g, '');
	if (slug.length > 0) return slug;
	if (fallbackStep !== undefined) return `step-${fallbackStep}`;
	throw typedError(
		'STEP_HAS_NO_DESCRIPTION',
		'Step description contains no alphanumeric characters to form a capture name.',
		'Add a descriptive text string to the step in the scenario, or pass an explicit capture name.'
	);
}

/**
 * Build validated `JobCapturePoint[]` entries from 1-based step selections
 * (bare step numbers or `{ step, name?, before? }`).
 */
export function buildJobCaptures(
	scenario: JobScenario,
	selections: readonly (number | JobCaptureSelection)[]
): JobCapturePoint[] {
	if (selections.length === 0) {
		throw typedError(
			'JOB_SCENARIO_INVALID',
			'At least one capture step must be selected.',
			'Pass one or more 1-based step numbers or { step, name?, before? } objects.'
		);
	}

	const normalized = selections.map((item) =>
		typeof item === 'number' ? { step: item } : { ...item }
	);
	const seenSteps = new Set<number>();
	const seenNames = new Set<string>();
	const points: JobCapturePoint[] = [];

	for (const selection of normalized) {
		if (!Number.isInteger(selection.step) || selection.step < 1) {
			throw typedError(
				'CAPTURE_STEP_UNKNOWN',
				`Capture step ${String(selection.step)} is invalid; steps are numbered from 1.`,
				`Choose a step number between 1 and ${scenario.steps.length}.`
			);
		}
		const matchedStep = scenario.steps.find((step) => step.step === selection.step);
		if (!matchedStep) {
			throw typedError(
				'CAPTURE_STEP_UNKNOWN',
				`Step ${selection.step} does not exist in scenario '${scenario.job}' (which has ${scenario.steps.length} steps).`,
				`Choose a step number between 1 and ${scenario.steps.length}, or update the scenario.`
			);
		}
		if (seenSteps.has(matchedStep.step)) {
			throw typedError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Step ${matchedStep.step} is selected more than once in captures.`,
				'Select each scenario step at most once.'
			);
		}
		seenSteps.add(matchedStep.step);

		const description = matchedStep.description;
		if (typeof description !== 'string' || description.trim() === '') {
			throw typedError(
				'STEP_HAS_NO_DESCRIPTION',
				`Step ${matchedStep.step} ('${matchedStep.command}') has no description and cannot be marked for capture.`,
				`Add a description to step ${matchedStep.step} in the scenario; it does not change the format.`,
				{ step: matchedStep.step, command: matchedStep.command }
			);
		}

		const matchingSteps = scenario.steps.filter((step) => step.description === description);
		if (matchingSteps.length > 1) {
			const nums = matchingSteps.map((s) => s.step).join(', ');
			throw typedError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Step ${matchedStep.step}'s description "${description}" matches ${matchingSteps.length} steps (${nums}).`,
				'Give each captured step a unique description in the scenario file.'
			);
		}

		const name = selection.name ?? slugifyStepDescription(description, matchedStep.step);
		if (!JOB_CAPTURE_NAME.test(name)) {
			throw typedError(
				'JOB_SCENARIO_INVALID',
				`Capture name '${name}' for step ${matchedStep.step} is invalid; expected ${JOB_CAPTURE_NAME}.`,
				'Use an alphanumeric capture name containing only letters, digits, dots, underscores, or hyphens.',
				{ step: matchedStep.step, name }
			);
		}
		if (seenNames.has(name)) {
			throw typedError(
				'CAPTURE_STEP_AMBIGUOUS',
				`Capture name '${name}' is produced more than once.`,
				'Pass distinct explicit capture names or give each captured step a distinct description.'
			);
		}
		seenNames.add(name);

		points.push({
			after: description,
			name,
			...(selection.before && selection.before.length > 0 ? { before: [...selection.before] } : {}),
		});
	}

	return points;
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

export interface BuildJobCaptureItemsResult {
	items: WriteCaptureSetItem[];
	steps: JobStepResult[];
	captureSummaries: Omit<JobCaptureSummary, 'screenshot'>[];
	firstObs?: Observation;
	status: 'passed' | 'failed';
}

/**
 * Evaluate a completed job driver's step outcomes and raw captures into `WriteCaptureSetItem[]`,
 * enforcing no capture after any failed step (including under `continueOnFailure`), detecting
 * `unchanged` against the previous marked capture, and stamping `manifest.job` metadata.
 */
export async function buildJobCaptureItems(options: {
	entry: SpecimenEntry;
	scenario: JobScenario;
	capturePlan: readonly ResolvedJobCapture[];
	driverResult: JobDriverResult;
	capturedByKey: ReadonlyMap<string, { observation: Observation; screenshotSource: string | null }>;
}): Promise<BuildJobCaptureItemsResult> {
	if (!options.entry.job) {
		throw typedError(
			'NOT_A_JOB',
			`Specimen '${options.entry.id}' is not a job specimen.`,
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.',
			{ id: options.entry.id }
		);
	}
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

	const status: 'passed' | 'failed' =
		firstFailedStep !== null || options.driverResult.status === 'failed' ? 'failed' : 'passed';
	return {
		items: writeItems,
		steps,
		captureSummaries,
		...(firstObs !== undefined ? { firstObs } : {}),
		status,
	};
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
	const {
		items: writeItems,
		steps,
		captureSummaries,
		firstObs,
		status,
	} = await buildJobCaptureItems({
		entry: options.entry,
		scenario: options.scenario,
		capturePlan: options.capturePlan,
		driverResult: options.driverResult,
		capturedByKey: options.capturedByKey,
	});

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

function sortSetEntries(entries: readonly CaptureSetEntry[]): CaptureSetEntry[] {
	return [...entries].sort(
		(a, b) =>
			compareCodeUnits(a.id, b.id) ||
			(a.step ?? -1) - (b.step ?? -1) ||
			compareCodeUnits(a.key, b.key)
	);
}

/** Read one kept observation from a saved capture set by specimen id and optional checkpoint without launching a browser. */
export async function readObservationFromSet(
	root: string,
	ref: { id: string; set: string; checkpoint?: string }
): Promise<Observation> {
	const setId = await resolveCaptureSetId(root, ref.set);
	const manifest = await readCaptureSetManifest(root, setId);
	const allEntries = sortSetEntries(Object.values(manifest.captures));

	let matches: CaptureSetEntry[];
	if (ref.checkpoint === undefined && Object.hasOwn(manifest.captures, ref.id)) {
		matches = [manifest.captures[ref.id] as CaptureSetEntry];
	} else {
		const forId = allEntries.filter((entry) => entry.id === ref.id || entry.key === ref.id);
		matches =
			ref.checkpoint === undefined
				? forId
				: forId.filter(
						(entry) => (entry.checkpoint ?? manifest.checkpoint.name) === ref.checkpoint
					);
	}

	if (matches.length === 0) {
		const forId = allEntries.filter((entry) => entry.id === ref.id || entry.key === ref.id);
		if (forId.length > 0 && ref.checkpoint !== undefined) {
			const available = forId.map((entry) => entry.checkpoint ?? manifest.checkpoint.name);
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`Checkpoint '${ref.checkpoint}' for '${ref.id}' was not found in set ${setId}.`,
				`Pass one of the checkpoints recorded in set ${setId} for '${ref.id}': ${available.join(', ')}.`,
				{ set: setId, id: ref.id, checkpoint: ref.checkpoint, available }
			);
		}
		const nearest = nearestSpecimenIds(
			ref.id,
			allEntries.map((entry) => entry.id)
		);
		const hint = nearest.length
			? `Specimen '${ref.id}' is not in set ${setId}. Did you mean ${nearest.join(', ')}?`
			: `Specimen '${ref.id}' is not in set ${setId}; run specimen-job-run or specimen-capture first.`;
		throw typedError(
			'SPECIMEN_NOT_FOUND',
			`Specimen '${ref.id}' was not found in set ${setId}.`,
			hint,
			{ set: setId, id: ref.id, nearest }
		);
	}

	if (matches.length > 1) {
		const available = matches.map((entry) => entry.checkpoint ?? entry.key);
		throw typedError(
			'SPECIMEN_NOT_FOUND',
			`Set ${setId} contains ${matches.length} captures for '${ref.id}'; pass checkpoint to choose one.`,
			`Call specimen-render with id '${ref.id}', set '${setId}', and checkpoint set to one of: ${available.join(', ')}.`,
			{ set: setId, id: ref.id, available }
		);
	}

	const matched = matches[0] as CaptureSetEntry;
	if (matched.status !== 'captured' || !matched.observation) {
		throw typedError(
			'SPECIMEN_NOT_FOUND',
			`Capture '${matched.key}' (${matched.checkpoint ?? ref.checkpoint ?? 'default'}) was not taken in set ${setId}: ${matched.reason ?? 'unavailable'}.`,
			'Fix the failing step and run specimen-job-run again to capture this checkpoint.',
			{ set: setId, id: ref.id, key: matched.key, reason: matched.reason ?? null }
		);
	}

	const observation = await readSetCapture(root, { set: setId, id: matched.key });
	return observation.manifest.set === setId
		? observation
		: { ...observation, manifest: { ...observation.manifest, set: setId } };
}

/** Read recorded accessibility results from a capture set without launching a browser or replaying any step. */
export async function readA11yFromSet(
	root: string,
	request: A11yRequest & { set: string }
): Promise<A11yRun> {
	const started = performance.now();
	if (request.id !== undefined && request.filter !== undefined) {
		throw new Error('Give an id for one entry, or a filter, not both.');
	}
	if (request.filter?.file !== undefined || request.filter?.tags !== undefined) {
		throw new Error(
			'Set-backed specimen-a11y does not support filter.file or filter.tags; omit them or use id, checkpoint, filter.ids, or filter.match.'
		);
	}
	const setId = await resolveCaptureSetId(root, request.set);
	const manifest = await readCaptureSetManifest(root, setId);
	const allEntries = sortSetEntries(Object.values(manifest.captures));
	let entries = allEntries;

	if (request.id !== undefined) {
		entries = entries.filter((entry) => entry.id === request.id || entry.key === request.id);
		if (entries.length === 0) {
			const availableIds = [...new Set(allEntries.flatMap((entry) => [entry.id, entry.key]))];
			const nearest = nearestSpecimenIds(request.id, availableIds);
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`Specimen '${request.id}' not found in capture set ${setId}.`,
				nearest.length
					? `Did you mean ${nearest.join(', ')}?`
					: `Capture set ${setId} contains no capture for '${request.id}'.`,
				{ set: setId, id: request.id, nearest }
			);
		}
	}
	if (request.checkpoint !== undefined) {
		const checkpointMatches = entries.filter(
			(entry) => (entry.checkpoint ?? manifest.checkpoint.name) === request.checkpoint
		);
		if (checkpointMatches.length === 0 && entries.length > 0) {
			const available = [
				...new Set(entries.map((entry) => entry.checkpoint ?? manifest.checkpoint.name)),
			];
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`Checkpoint '${request.checkpoint}' not found in capture set ${setId}.`,
				available.length
					? `Available checkpoints in set ${setId}: ${available.join(', ')}.`
					: `Capture set ${setId} contains no matching captures.`,
				{ set: setId, checkpoint: request.checkpoint, available }
			);
		}
		entries = checkpointMatches;
	}
	if (request.filter?.ids && request.filter.ids.length > 0) {
		const idSet = new Set(request.filter.ids);
		const missing = request.filter.ids.filter(
			(wanted) => !entries.some((entry) => entry.id === wanted || entry.key === wanted)
		);
		if (missing.length > 0) {
			const first = missing[0] as string;
			const availableIds = [...new Set(allEntries.flatMap((entry) => [entry.id, entry.key]))];
			const nearest = nearestSpecimenIds(first, availableIds);
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`Specimen '${first}' not found in capture set ${setId}.`,
				nearest.length
					? `Did you mean ${nearest.join(', ')}?`
					: `Capture set ${setId} contains no capture for '${first}'.`,
				{ set: setId, id: first, nearest }
			);
		}
		entries = entries.filter((entry) => idSet.has(entry.id) || idSet.has(entry.key));
	}
	if (request.filter?.match) {
		const needle = request.filter.match.toLowerCase();
		entries = entries.filter((entry) =>
			`${entry.id} ${entry.key} ${entry.checkpoint ?? ''} ${entry.job ?? ''}`
				.toLowerCase()
				.includes(needle)
		);
		if (entries.length === 0 && allEntries.length > 0) {
			throw typedError(
				'SPECIMEN_NOT_FOUND',
				`No capture in set ${setId} matched '${request.filter.match}'.`,
				`Inspect set ${setId} captures or omit filter.match to check every capture in the set.`,
				{ set: setId, match: request.filter.match }
			);
		}
	}

	const reports: A11yReport[] = [];
	for (const entry of entries) {
		const checkpointName = entry.checkpoint ?? manifest.checkpoint.name;
		if (entry.status !== 'captured' || !entry.observation) {
			reports.push({
				status: 'not-run',
				policy: 'error',
				reason: entry.reason ?? 'Capture was not taken.',
				violations: [],
				incomplete: 0,
				incompleteChecks: [],
				exceptions: [],
				id: entry.id,
				checkpoint: checkpointName,
				...(entry.job !== undefined && entry.step !== undefined
					? { job: { name: entry.job, step: entry.step } }
					: {}),
				failures: [],
			});
			continue;
		}
		const observation = await readSetCapture(root, { set: setId, id: entry.key });
		const jobMeta =
			observation.manifest.job ??
			(entry.job !== undefined && entry.step !== undefined
				? { name: entry.job, step: entry.step }
				: undefined);
		const axe = observation.channels.a11y.axe;
		if (axe === 'not-run') {
			reports.push({
				status: 'not-run',
				policy: 'off',
				reason: 'axe was not run when this capture set was created.',
				violations: [],
				incomplete: 0,
				incompleteChecks: [],
				exceptions: [],
				id: entry.id,
				checkpoint: entry.checkpoint ?? observation.manifest.checkpoint.name,
				...(jobMeta ? { job: jobMeta } : {}),
				failures: [],
			});
			continue;
		}
		reports.push({
			...axe,
			id: entry.id,
			checkpoint: entry.checkpoint ?? observation.manifest.checkpoint.name,
			...(jobMeta ? { job: jobMeta } : {}),
			failures: [],
		});
	}

	const count = (status: A11yReport['status']) =>
		reports.filter((report) => report.status === status).length;
	return {
		reports,
		counts: {
			total: reports.length,
			passed: count('passed'),
			warning: count('warning'),
			failed: count('failed'),
			notRun: count('not-run'),
		},
		workers: 1,
		elapsedMs: performance.now() - started,
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
	target?: ValidationTarget,
	options: { hasPlugins?: boolean } = {}
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
		let captureError = false;
		try {
			resolveJobCapturePlan(entry, scenario);
		} catch (error) {
			captureError = true;
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
		if (!captureError && options.hasPlugins === false) {
			issues.push({
				severity: 'deferred',
				code: 'RUNNER_MISSING',
				message: `Job specimen '${entry.id}' requires a registered job driver plugin (such as '${entry.job?.runner ?? 'afd'}'), but no plugins are configured.`,
				suggestion:
					'Configure a Specimen plugin providing the job driver and command runner (such as @lushly-dev/specimen-afd-runner) in specimen.config.json plugins.',
				id: entry.id,
				importPath: scenarioPath,
				field: 'plugins',
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

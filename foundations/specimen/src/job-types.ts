/**
 * Job specimen, multi-checkpoint, and `JobSource` / `JobDriver` contracts.
 * Re-exported from `types.ts` and `@lushly-dev/specimen/types`.
 */
import type { CaptureSetRun, SpecimenAction, SpecimenContext, SpecimenEntry } from './types.js';

/** A person action declared in a job entry's `captures[].before` list. */
export interface JobBeforeAction {
	action: SpecimenAction;
}
/** Deterministic runtime pins declared on a job entry or multi-checkpoint request. */
export interface JobPin {
	/** ISO-8601 instant with timezone (`Z` or `±HH:MM`) to pin `Date` and timers to. */
	clock?: string;
}
/** One marked capture point inside a job specimen entry. */
export interface JobCapturePoint {
	/** Exact `description` text of the scenario step after which to capture. */
	after: string;
	/** Checkpoint name recorded in the manifest and set entry. */
	name: string;
	/** Optional Specimen person actions run immediately before this step's command. */
	before?: JobBeforeAction[];
}
/** Configuration block marking a specimen entry as a job specimen. */
export interface JobConfig {
	/** Path to the job's scenario file, relative to `specimen.config.json`. */
	scenario: string;
	/** Target name on the mounted specimen whose element receives application commands. */
	target: string;
	/** Optional registered runner/driver id (defaults to `'afd'`). */
	runner?: string;
	/** Optional deterministic clock pin for every run of this job specimen. */
	pin?: JobPin;
	/** Marked capture points, each naming a step by exact description. */
	captures: JobCapturePoint[];
}
/** AFD-free parsed job scenario step handed to Specimen by a `JobSource` plugin. */
export interface JobScenarioStep {
	/** 1-based step number, matching the scenario runner's `stepId`. */
	step: number;
	command: string;
	description?: string;
	input?: Record<string, unknown>;
	expect?: unknown;
	continueOnFailure?: boolean;
}
/** AFD-free parsed job scenario returned by a `JobSource` plugin or passed to `runJob()`. */
export interface JobScenario {
	job: string;
	name?: string;
	description?: string;
	fixture?: unknown;
	steps: JobScenarioStep[];
}
/** One capture point resolved against a parsed `JobScenario`'s 1-based step numbers. */
export interface ResolvedJobCapture {
	after: string;
	name: string;
	step: number;
	/** Capture set entry key: `<id>/<step>`. */
	key: string;
	before: JobBeforeAction[];
}
/** Reported deterministic pins active during a multi-checkpoint or job run. */
export interface PinnedBaseline {
	clock: string;
	random: 'seeded';
}
export type JobCaptureStatus = 'captured' | 'unchanged' | 'not-taken';
export interface JobStepCaptureSummary {
	key: string;
	name: string;
	status: JobCaptureStatus;
	reason?: string;
	actions?: number;
}
export interface JobStepResult {
	step: number;
	description?: string;
	command?: string;
	status: 'passed' | 'failed' | 'skipped';
	error?: string;
	capture?: JobStepCaptureSummary;
}
export interface JobCaptureSummary {
	key: string;
	name: string;
	step: number;
	status: JobCaptureStatus;
	screenshot: string | null;
	reason?: string;
}
/** Request to capture multiple named checkpoints of one native specimen in a single fresh render. */
export interface CheckpointsRequest {
	id: string;
	/** Named checkpoints to keep in scenario order; omit to keep every `{ capture }` step, or pass a non-empty list of unique names to filter. */
	checkpoints?: string[];
	context?: Partial<SpecimenContext>;
	/** Optional local pointer label in `.specimen/labels.json`. */
	label?: string;
	/** Run axe at each captured checkpoint (default `true`). */
	axe?: boolean;
	timeoutMs?: number;
	/** Optional clock pin for this multi-checkpoint render. */
	pin?: JobPin;
}
/** Compact result of `bench.captureCheckpoints()` (references and counts only). */
export interface CheckpointsRun {
	set: string;
	label: string | null;
	id: string;
	revision: string | null;
	dirty: boolean | null;
	pinned: PinnedBaseline;
	captures: JobCaptureSummary[];
	counts: CaptureSetRun['counts'];
}
/** Step selection input for `specimen-job-create`: bare 1-based step number or detailed capture point. */
export interface JobCaptureSelection {
	/** 1-based step number in the scenario. */
	step: number;
	/** Optional capture checkpoint name (defaults to deterministic kebab-case slug of the step description). */
	name?: string;
	/** Optional Specimen person actions run immediately before this step's command. */
	before?: JobBeforeAction[];
}
/** Request to scaffold a job specimen entry in `specimen.config.json` from a scenario file. */
export interface JobCreateRequest {
	id: string;
	title?: string;
	scenario: string;
	module: string;
	exportName: string;
	target: string;
	runner?: string;
	pin?: JobPin;
	captures: (number | JobCaptureSelection)[];
}
/** Compact result of `bench.createJob()` / `specimen-job-create`. */
export interface JobCreateResult {
	written: string;
	entry: SpecimenEntry & { kind: 'job'; job: JobConfig };
}
/** Request to run a job specimen once in a fresh browser context and save its captures into a set. */
export interface JobRunRequest {
	id: string;
	context?: Partial<SpecimenContext>;
	/** Optional local pointer label in `.specimen/labels.json`. */
	label?: string;
	/** Run axe at each captured step (default `true`). */
	axe?: boolean;
	timeoutMs?: number;
	/** Optional clock pin override (defaults to `entry.job.pin`). */
	pin?: JobPin;
	/** Optional pre-parsed scenario when no `JobSource` module is configured. */
	scenario?: JobScenario;
}
/** Compact result of `bench.runJob()` (references and step statuses only, never observations). */
export interface JobRun {
	set: string;
	label: string | null;
	id: string;
	job: string;
	scenario: string;
	status: 'passed' | 'failed';
	pinned: PinnedBaseline;
	steps: JobStepResult[];
	captures: JobCaptureSummary[];
	counts: CaptureSetRun['counts'];
}
export interface JobSourceContext {
	/** The project root. */
	root: string;
	/** The directory the configuration file is in, which scenario paths are relative to. */
	base: string;
	/** The job specimen entry whose scenario is being parsed. */
	entry: SpecimenEntry;
	/** The scenario path from `entry.job.scenario`. */
	scenarioPath: string;
	/** Read a text file relative to `base`; paths escaping `root` are refused. */
	read(path: string): Promise<string>;
}
export interface JobSource {
	id: string;
	version?: string;
	/** Return true if this source handles the given scenario path (defaults to handling all). */
	supports?(scenarioPath: string, entry: SpecimenEntry): boolean;
	/** Parse the scenario file into Specimen's AFD-free `JobScenario` shape. */
	parseScenario(context: JobSourceContext): JobScenario | Promise<JobScenario>;
}

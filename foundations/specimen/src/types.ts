import type { ComponentCoverage, CoverageLevel } from './coverage.js';
import type { ComponentSchema } from './plugin.js';

/** Public contracts: native specimens, retained stories and their plugins. */
export const CAPTURE_VERSION = '0.8' as const;
export const NORMALIZATION_VERSION = '0.2' as const;

export type { Args, Decorator, Meta, Preview, StoryContext, StoryObj } from './csf-types.js';

export interface SpecimenContext {
	viewport: { width: number; height: number };
	container?: { width: number; height?: number };
	/** `high-contrast` is the light color scheme with `prefers-contrast: more`. */
	theme: 'light' | 'dark' | 'high-contrast';
	locale: string;
	reducedMotion: 'reduce' | 'no-preference';
	motion: 'natural' | 'settled';
	/**
	 * Absent: the theme also sets the media it implies (`prefers-color-scheme`,
	 * `prefers-contrast`). `browser-default`: the theme is applied by the page alone and media
	 * keep the browser's defaults, as Storybook's Vitest runner leaves them for a retained story.
	 */
	themeMedia?: 'browser-default';
}
export type Target = { selector: string } | { role: string; name?: string };
export type ScenarioStep =
	| {
			id?: string;
			action:
				| { click: string }
				| { focus: string }
				| { hover: string }
				| { fill: string; value: string };
	  }
	| {
			id?: string;
			/** An explicit command through a named plugin runner, on a declared target. */
			command: { runner: string; name: string; target: string; input?: unknown };
	  }
	| {
			id?: string;
			/** What must hold here. A claim names this step's id to link it to an obligation. */
			expect: Expectation;
	  }
	| { capture: string };
/** A declared event, on a declared target or, with none, anywhere its listener can see. */
export interface EventDeclaration {
	type: string;
	target?: string;
}
export interface EventExpectation {
	event: string;
	target?: string;
	/** The step whose start begins the interval, so an earlier event cannot satisfy this. */
	since: string;
	/** How long to wait for it, within the render's deadline. Defaults to 1,000 ms. */
	timeoutMs?: number;
	/** It must not happen: the wait runs out, and the event was not seen. */
	absent?: boolean;
	/** The step's id, which a run records. */
	id?: string;
}
/** A live property or an attribute of a declared target. Give one of the two. */
export interface StateExpectation {
	target: string;
	state: { property?: string; attribute?: string; equals: string | number | boolean | null };
	timeoutMs?: number;
	id?: string;
}
/** An entry in the real `FormData` of the target's form; a `null` value means no such entry. */
export interface FormExpectation {
	target: string;
	form: { name: string; value: string | null };
	timeoutMs?: number;
	id?: string;
}
/** What the target's own `checkValidity()` answers. */
export interface ValidityExpectation {
	target: string;
	validity: { valid: boolean };
	timeoutMs?: number;
	id?: string;
}
export type Expectation =
	| EventExpectation
	| StateExpectation
	| FormExpectation
	| ValidityExpectation;
/**
 * A specimen's claim that named expectations prove an obligation, on a declared target at a
 * checkpoint. Coverage checks it against the run: a claim asserts nothing it does not show.
 */
export interface CoverageClaim {
	target: string;
	/** As a coverage report names it, such as `property:disabled=true` or `form:validity`. */
	obligation: string;
	checkpoint: string;
	/** Ids of `expect` steps at or before the checkpoint. */
	expectations: string[];
}
/** An expectation that ran and held, or a play's report of one. */
export interface ExpectationRecord {
	id: string;
	kind: 'event' | 'state' | 'form' | 'validity' | 'play';
	target: string | null;
	event?: string;
	/** What it found: the property, form entry or validity. */
	detail?: unknown;
}
export interface ClaimRecord {
	target: string;
	/** The target's reference in this capture; `null` when it never resolved. */
	ref: string | null;
	obligation: string;
	checkpoint: string;
	expectations: string[];
	source: 'declared' | 'play';
}
export interface EvidenceChannel {
	expectations: ExpectationRecord[];
	claims: ClaimRecord[];
	/** Commands the scenario ran, by name. */
	commands: string[];
	/** In a coverage or contract run: tags in a form that `new FormData(form)` read, a play's included. */
	formData: string[];
	/** In such a run: tags whose validity something checked, with their shadow hosts. */
	validity: string[];
	/** In such a run: `tag:attribute` for each attribute set on a watched tag. */
	attributesSet: string[];
}
export interface EventRecord {
	type: string;
	/** The declared target it was on; `null` when none was declared or known yet. */
	target: string | null;
	/** The named step whose interval it fell in; `null` for mount or an unnamed step. */
	step: string | null;
	composed: boolean;
	bubbles: boolean;
	trusted: boolean;
	/** A `CustomEvent`'s `detail`, with functions and nodes described rather than serialized. */
	detail: unknown;
}
export interface MountHandle {
	element: HTMLElement;
	ready?: Promise<void>;
	dispose?: () => void | Promise<void>;
}
export interface SpecimenDefinition {
	args?: Record<string, unknown>;
	render?: (
		args: Record<string, unknown>
	) => HTMLElement | MountHandle | Promise<HTMLElement | MountHandle>;
	targets?: Record<string, Target>;
	scenario?: ScenarioStep[];
	ready?: () => void | Promise<void>;
	dispose?: () => void | Promise<void>;
	a11y?: NativeAccessibility;
	events?: EventDeclaration[];
	/** What this specimen's expectations prove, for coverage. */
	coverage?: CoverageClaim[];
}
export interface SpecimenModule {
	default?: {
		component?: string;
		args?: Record<string, unknown>;
		render?: SpecimenDefinition['render'];
	};
	[name: string]: unknown;
}
export interface SpecimenEntry {
	id: string;
	title: string;
	/** A native entry's module, relative to the configuration file; a story's import path. */
	module: string;
	exportName: string;
	component?: string;
	/** Present on retained stories discovered in CSF compatibility mode. */
	story?: StoryIdentity;
	/** Sent with a render, not discovered: properties to read live on each tag, for coverage. */
	observe?: Record<string, string[]>;
}
/** What Storybook's index gives a retained story, and what discovery could not read. */
export interface StoryIdentity {
	name: string;
	tags: string[];
	/** Whether the story or its meta has a play function; `unknown` when not readable statically. */
	play: 'present' | 'absent' | 'unknown';
	/** Fields whose values are only known when the module runs. */
	unresolved: { level: 'meta' | 'story'; field: string; reason: string }[];
	/** Annotation fields each level sets; `*` when a level may set fields that cannot be read. */
	annotations: { meta: string[]; story: string[] };
}
/** Storybook's stories specifier: files matching `files` under `directory`. */
export interface StoriesSpecifier {
	directory: string;
	files?: string;
	titlePrefix?: string;
}
export interface BenchConfig {
	/** Native specimens. */
	specimens?: SpecimenEntry[];
	/** CSF compatibility mode: retained story files, as Storybook's `stories` names them. */
	stories?: (string | StoriesSpecifier)[];
	/** The project annotations module (Storybook's preview), relative to the configuration. */
	preview?: string;
	/**
	 * Directories served at the page's origin, as Storybook's `staticDirs`: a path served at
	 * `/`, or `from` served at `to`. Relative to the configuration, and inside the root.
	 */
	staticDirs?: (string | { from: string; to: string })[];
	/**
	 * Which retained stories run, as the Storybook Vitest addon's `tags` option selects them:
	 * `include` defaults to `['test']`; `skip` reports a story skipped without running it.
	 */
	test?: {
		include?: string[];
		exclude?: string[];
		skip?: string[];
		/** Stories a suite runs at once, unless its request says otherwise. */
		workers?: number;
		/** A retained story's deadline, as Vitest's `testTimeout`. Defaults to 15,000 ms, as Vitest's. */
		timeoutMs?: number;
	};
	/** Recorded performance baselines, relative to the configuration and inside the root. */
	profile?: { baselines?: string };
	coverage?: { waivers?: CoverageWaivers };
	/** Plugin modules, relative to the configuration: each default-exports a plugin or an array of them. */
	plugins?: string[];
	/** The custom elements manifest core reads component schemas from, relative to the configuration. */
	manifest?: string;
}
export interface ValidationIssue {
	/** `deferred`: only the module, run, can settle it. */
	severity: 'error' | 'warning' | 'deferred';
	code: string;
	message: string;
	suggestion: string;
	id?: string;
	importPath?: string;
	exportName?: string;
	field?: string;
}
export interface ValidationReport {
	valid: boolean;
	/** `static`: read without running any story module. */
	scope: 'static';
	checked: number;
	issues: ValidationIssue[];
}
export interface ValidationTarget {
	id?: string;
	/** An import path such as `./src/button.stories.ts`, or a path relative to the root. */
	file?: string;
}
export interface BenchOptions {
	root: string;
	/** Process isolation releases runtime caches on close at the cost of cold-start CPU. */
	runtimeIsolation?: 'in-process' | 'process';
	configFile?: string;
	executablePath?: string;
}
export interface CaptureRequest {
	id: string;
	context?: Partial<SpecimenContext>;
	checkpoint?: string;
	screenshot?: string;
	timeoutMs?: number;
}
/** The codemod's request: which story files, and whether to write the proposals. */
export interface MigrateRequest {
	/** Import paths, such as `./src/button.stories.ts`; every discovered story file when absent. */
	files?: string[];
	/** Write the proposed edits. The default is a preview that writes nothing. */
	apply?: boolean;
	/** Also switch helper and type imports to Specimen's own, where it has every name imported. */
	helpers?: boolean;
}
/** The codemod's file-by-file report. */
export interface MigrationReport {
	mode: 'preview' | 'apply';
	files: {
		importPath: string;
		component: {
			status: 'present' | 'proposed' | 'manual';
			tag?: string;
			reason: string;
			candidates: string[];
		};
		/** Meta fields kept exactly as written. */
		retained: string[];
		imports: {
			source: string;
			names: string[];
			typeOnly: boolean;
			/** Specimen's module with every name this imports, when there is one. */
			native?: string;
			reason: string;
		}[];
		manual: string[];
		diff?: string;
		applied: boolean;
	}[];
	problems: string[];
	summary: { files: number; present: number; proposed: number; manual: number; applied: number };
}
/** Inspection takes an id and, optionally, the context a render would request. */
export type InspectRequest = Pick<CaptureRequest, 'id' | 'context' | 'timeoutMs'>;
/** What inspection reports about one specimen or retained story, before any capture. */
export interface InspectResult {
	id: string;
	/** The component the entry describes, when it names one. */
	component: string | null;
	/** Core's schema enriched by the plugins; `null` when no source describes the component. */
	schema: ComponentSchema | null;
	/** The resolved args, with functions and nodes described rather than serialized. */
	args: Record<string, unknown>;
	/** The context a render would use. */
	context: SpecimenContext;
	/** A retained story's composed annotations. */
	story?: {
		name: string;
		tags: string[];
		globals: Record<string, unknown>;
		parameters: Record<string, unknown>;
		play: boolean;
		decorators: number;
		render: 'story' | 'meta' | 'project' | 'default';
		unsupported: string[];
		/** What the preview itself sets `parameters.a11y.test` to, whatever this story does. */
		projectPolicy: string | null;
	};
	/** Requested context that the entry does not get, and other limits of what was resolved. */
	limitations: string[];
	/** The plugins installed, by id, with the runners and themes they register. */
	plugins: { id: string; runners: string[]; themes: string[]; tokens: string | null }[];
}
/** Which stories in a suite keep their capture. A capture costs more than some stories' runs. */
export type SuiteCapture = 'all' | 'failed' | 'none';
/** The retained stories to run; every condition given must hold. */
export interface SuiteFilter {
	ids?: string[];
	/** An import path such as `./src/button.stories.ts`, or a path relative to the root. */
	file?: string;
	/** Any of these index tags. */
	tags?: string[];
	/** Text in the story's title and name, in any case. */
	match?: string;
}
/** Obligations deliberately not required, versioned so a report can say which set it applied. */
export interface CoverageWaivers {
	version: string;
	entries: { component: string; obligation: string; reason: string }[];
}
export interface SuggestRequest {
	component: string;
	/** Obligation ids to propose for; defaults to what a coverage run leaves unverified. */
	gaps?: string[];
	workers?: number;
	timeoutMs?: number;
}
export interface SuggestRun {
	component: string;
	/** Always: a proposal is not evidence until it has been run and corrected. */
	status: 'unverified';
	/** Where the module could go, relative to the manifest, beside the component. */
	file: string;
	/** The proposed native specimens, as a TypeScript module. */
	source: string;
	/** Configuration entries for those specimens. */
	entries: { id: string; title: string; module: string; exportName: string; component: string }[];
	suggestions: {
		obligation: string;
		exportName: string;
		/** What it assumes, or what to replace. */
		note?: string;
		/** It fails until someone replaces its expectation. */
		placeholder?: boolean;
	}[];
	/** Obligations with no proposal, and why. */
	skipped: { obligation: string; reason: string }[];
	elapsedMs: number;
}
export interface ContractRequest {
	/** One component: runs its own story file. */
	component?: string;
	filter?: SuiteFilter;
	timeoutMs?: number;
	workers?: number;
}
export interface ContractFinding {
	/** The Fastbot rule this replaces, such as `MISSING_STATE_STORY`. */
	code: string;
	severity: 'error' | 'warning';
	message: string;
	suggestion: string;
	component?: string;
	file?: string;
	attribute?: string;
}
export interface ContractRun {
	/** The rules applied, by version. */
	rules: string;
	/** No error, and no case failed. */
	valid: boolean;
	findings: ContractFinding[];
	counts: { errors: number; warnings: number };
	stats: { components: number; storyFiles: number; scoped: boolean };
	cases: { total: number; passed: number; failed: { id: string; message: string }[] };
	workers: number;
	elapsedMs: number;
}
export interface CoverageRequest {
	/** One component's tag; defaults to every component the schemas describe. */
	component?: string;
	filter?: SuiteFilter;
	timeoutMs?: number;
	workers?: number;
}
export interface CoverageRun {
	/** The obligations required, by version. */
	obligations: string;
	/** Whether every required obligation is verified. */
	complete: boolean;
	components: ComponentCoverage[];
	counts: Record<CoverageLevel, number>;
	/** Obligations a waiver covers, whatever their level. */
	waived: number;
	waivers: {
		version: string | null;
		/** Entries matching no obligation, such as after a component changed. */
		unused: CoverageWaivers['entries'];
	};
	/** Claims the run could not honor. Any of these keeps a run from being complete. */
	invalidClaims: { specimen: string; target: string; obligation: string; reason: string }[];
	/** What the evidence came from: only cases that passed count. */
	cases: {
		total: number;
		passed: number;
		failed: { id: string; message: string }[];
		skipped: number;
	};
	workers: number;
	elapsedMs: number;
}
export interface SuiteRequest {
	filter?: SuiteFilter;
	context?: Partial<SpecimenContext>;
	timeoutMs?: number;
	/** Stories run at once; defaults to `test.workers` in the configuration, then 2. */
	workers?: number;
	/** Retry failures once, one at a time, when no more than `flakeCap` stories failed. */
	retry?: boolean;
	flakeCap?: number;
	/** Defaults to `failed`. */
	capture?: SuiteCapture;
}
export interface SuiteStory {
	id: string;
	/** Relative to the root, without a leading `./`. */
	file: string;
	title: string;
	name: string;
	/** The story's key in a consumer's flake records, as the incumbent's runner writes it. */
	flakeId: string;
	/** `flaky`: failed, then passed on its retry. */
	status: StoryOutcome['status'] | 'flaky';
	/** One outcome per attempt, the first run's first. */
	attempts: StoryOutcome[];
	/** The last attempt's capture, as `capture` selects. */
	observation: Observation | null;
}
export interface SuiteRun {
	outcome: 'passed' | 'passed-with-flake' | 'failed' | 'failed-after-retry';
	counts: {
		total: number;
		passed: number;
		failed: number;
		flaky: number;
		skipped: number;
		excluded: number;
	};
	retry: { ran: boolean; reason?: string };
	stories: SuiteStory[];
	workers: number;
	elapsedMs: number;
	/** A bundled source changed during the run; the stories ran against the sources at its start. */
	sourcesChanged: boolean;
}
/** A retained story's run: like a capture request, always at the after-run checkpoint. */
export type RunRequest = Omit<CaptureRequest, 'checkpoint'>;
export interface StoryRun {
	id: string;
	outcome: StoryOutcome;
	/** The capture after the run; `null` when the story did not render. */
	observation: Observation | null;
}
export interface Completeness {
	status: 'complete' | 'partial' | 'unsupported' | 'not-requested';
	scope: string;
	reasons: string[];
}
export interface ElementObservation {
	ref: string;
	tag: string;
	attributes: Record<string, string>;
	box: { x: number; y: number; width: number; height: number };
	scroll: { width: number; height: number; clientWidth: number; clientHeight: number };
	styles: Record<string, string>;
	state: Record<string, string | number | boolean | null>;
}
export interface BrowserObservation {
	dom: string;
	elements: ElementObservation[];
	limitations: string[];
	events: { declared: EventDeclaration[]; history: EventRecord[]; unresolved: string[] };
	/** What the specimen document observes, compared with the requested context at capture. */
	viewport: {
		width: number;
		height: number;
		media: boolean;
		colorScheme: 'light' | 'dark';
		contrast: 'more' | 'less' | 'custom' | 'no-preference';
		reducedMotion: 'reduce' | 'no-preference';
		language: string;
		devicePixelRatio: number;
	};
	/** The readiness the page applied, ending with how it came out. */
	ready: { steps: string[]; outcome: 'ready' | 'elements-undefined' };
	/** The plugins installed, with the version each declares. */
	plugins: { id: string; version: string | null }[];
	resources: CaptureResources;
	evidence: EvidenceChannel;
}
/** What the page loaded beyond the bench's own files, whose digests are in `source.digest`. */
export interface CaptureResources {
	/** Each font face the document knows, and how it ended up. */
	fonts: { family: string; weight: string; style: string; status: string }[];
	/** Each URL on another origin the page asked for; status 0 when it failed or did not say. */
	remote: { url: string; status: number }[];
}
/** What a capture records of its context: the one resolved, and what the document made of it. */
export interface RecordedContext extends SpecimenContext {
	/** The device pixel ratio requested; the bench fixes 1. */
	pixelRatio: number;
	observed: BrowserObservation['viewport'];
	resources: CaptureResources;
}
export interface CaptureCheckpoint {
	name: string;
	/** How the page got there: nothing, the host's real input, or a retained story's play. */
	actionMode: 'none' | 'real-input' | 'play';
	ready: BrowserObservation['ready'] & { deadlineMs: number };
	/** What each case starts from. Fixtures are the files the page loaded: `source.digest`. */
	baseline: {
		clock: 'real';
		random: { source: 'seeded'; seed: number };
		storage: 'empty';
	};
}
export interface CaptureManifest {
	captureVersion: string;
	normalizationVersion: string;
	specimenId: string;
	capturedUtc: string;
	bench: { name: string; version: string; plugins: BrowserObservation['plugins'] };
	/** What drove the page, and the context axes it emulates rather than only requests. */
	driver: { name: 'host'; emulates: string[] };
	checkpoint: CaptureCheckpoint;
	source: { revision: string | null; digest: string; dirty: boolean | null };
	dependencies: string;
	/** `build` is a digest of the executable's path, when one other than the bundled build ran. */
	browser: { name: string; version: string; platform: string; build: string | null };
	context: RecordedContext;
}
export interface Observation {
	manifest: CaptureManifest;
	channels: {
		dom: { raw: string; normalized: string };
		a11y: { snapshot: string; axe: 'not-run' | AxeOutcome };
		events: { declared: EventDeclaration[]; history: EventRecord[] };
		/** The expectations that held, the claims made of them and the commands run. */
		evidence: EvidenceChannel;
		elements: ElementObservation[];
		console: { errors: string[]; warnings: string[] };
		visual: { path: string | null };
	};
	completeness: Record<
		'dom' | 'a11y' | 'layout' | 'styles' | 'tokens' | 'events' | 'visual',
		Completeness
	>;
}
export interface ChannelDifference {
	channel: 'dom' | 'a11y' | 'layout' | 'styles' | 'state' | 'events';
	target?: string;
	property?: string;
	left: unknown;
	right: unknown;
}
export interface DiffOptions {
	allowContextDifferences?: (keyof SpecimenContext)[];
	requireVisual?: boolean;
}
export interface ObservationDiff {
	status: 'changed' | 'no-change-observed' | 'insufficient-evidence';
	differences: ChannelDifference[];
	limitations: string[];
}
/** One axe rule's finding: a violation, or a check it could not complete. */
export interface AxeFinding {
	id: string;
	impact: string | null;
	help: string;
	targets: string[];
	/** Axe's explanation for each target, such as the contrast it measured. */
	details: string[];
}
/** A native exception and what it excused in this check; none means it may be stale. */
export interface AxeException {
	rule: string;
	target: string;
	reason: string;
	matched: string[];
}
export interface AxeOutcome {
	/** `warning`: violations under `parameters.a11y.test: 'todo'`. */
	status: 'passed' | 'warning' | 'failed' | 'not-run';
	policy: 'error' | 'todo' | 'off' | 'disabled' | 'manual';
	reason?: string;
	violations: AxeFinding[];
	incomplete: number;
	/** What axe could not decide and a person must, such as contrast over an image. */
	incompleteChecks: AxeFinding[];
	exceptions: AxeException[];
	engine?: string;
}
/** A native specimen's accessibility policy. Every exclusion names why and, for a rule, where. */
export interface NativeAccessibility {
	disabled?: { reason: string };
	/** Excuses `rule` on `target`, a CSS selector, and everything inside it. */
	exceptions?: { rule: string; target: string; reason: string }[];
}
/** Check one entry by `id`, or those a `filter` selects; no id and no filter checks them all. */
export interface A11yRequest {
	id?: string;
	filter?: SuiteFilter;
	/** Defaults to `after-run`: a native scenario's end, or a story's play. */
	checkpoint?: string;
	context?: Partial<SpecimenContext>;
	timeoutMs?: number;
	workers?: number;
}
export interface A11yReport extends AxeOutcome {
	id: string;
	checkpoint: string;
	/** What stopped the run before the check: a story's play, or a render. */
	failures: { category: 'render' | 'play'; message: string }[];
}
export interface A11yRun {
	reports: A11yReport[];
	counts: { total: number; passed: number; warning: number; failed: number; notRun: number };
	workers: number;
	elapsedMs: number;
}
export interface MetricSummary {
	min: number;
	median: number;
	max: number;
}
/** One run's measurements at its checkpoint, in a fresh browser context. */
export interface ProfileSample {
	/** `null` when nothing painted in time, such as an empty render. */
	firstContentfulPaintMs: number | null;
	domContentLoadedMs: number;
	loadMs: number;
	/** Navigation start to the checkpoint. */
	readyMs: number;
	/** How long the capture at the checkpoint took. */
	captureMs: number;
	totalElements: number;
	customElements: number;
	shadowHosts: number;
	requestCount: number;
	transferSizeBytes: number;
	usedJSHeapSizeBytes: number;
	consoleErrors: number;
	consoleWarnings: number;
}
export interface ProfileSummary {
	paints: { firstContentfulPaintMs: MetricSummary | null };
	timings: {
		domContentLoadedMs: MetricSummary | null;
		loadMs: MetricSummary | null;
		readyMs: MetricSummary | null;
		captureMs: MetricSummary | null;
	};
	dom: {
		totalElements: MetricSummary | null;
		customElements: MetricSummary | null;
		shadowHosts: MetricSummary | null;
	};
	resources: { requestCount: MetricSummary | null; transferSizeBytes: MetricSummary | null };
	memory: { usedJSHeapSizeBytes: MetricSummary | null };
	console: { errorCount: number; warningCount: number };
}
export interface ProfileFlag {
	code: string;
	severity: 'warning' | 'high';
	message: string;
}
export interface ProfileFinding {
	code: string;
	metric: string;
	current: number;
	allowed: number;
	message: string;
}
/** A baselines file's entry. A record from another tool has no `runner`. */
export interface ProfileBaseline {
	storyId?: string;
	runner?: string;
	baseUrl?: string;
	viewport: string;
	checkpoint?: string;
	browser?: string;
	runs: number;
	capturedAt: string;
	source?: { revision: string | null; dirty: boolean | null };
	summary: {
		[Section in keyof ProfileSummary]?: Partial<ProfileSummary[Section]>;
	};
	budgets: {
		firstContentfulPaintMs?: number | null;
		totalElements?: number | null;
		requestCount?: number | null;
		transferSizeBytes?: number | null;
		usedJSHeapSizeBytes?: number | null;
		consoleErrorCount?: number | null;
		consoleWarningCount?: number | null;
	};
	notes: string[];
}
export interface ProfileBaselines {
	version?: string;
	description?: string;
	stories: Record<string, ProfileBaseline>;
}
export interface ProfileComparison {
	/** `not-comparable`: the baseline does not describe this measurement; see `reason`. */
	status: 'passed' | 'warnings' | 'failed' | 'not-comparable';
	reason?: string;
	baseline: { capturedAt: string; runs: number; runner: string | null };
	errors: ProfileFinding[];
	warnings: ProfileFinding[];
}
/** Profile one entry by `id`, or those a `filter` selects; neither profiles what has a baseline. */
export interface ProfileRequest {
	id?: string;
	filter?: SuiteFilter;
	/** Runs per entry, 1 to 7. Each is a fresh browser context, one at a time. */
	runs?: number;
	/** Defaults to `mount`, the ready checkpoint. */
	checkpoint?: string;
	context?: Partial<SpecimenContext>;
	timeoutMs?: number;
}
export interface BaselineRequest extends ProfileRequest {
	notes?: string[];
}
export interface ProfileReport {
	id: string;
	checkpoint: string;
	runs: number;
	viewport: string | null;
	browser: string | null;
	samples: ProfileSample[];
	summary: ProfileSummary | null;
	flags: ProfileFlag[];
	comparison: ProfileComparison | null;
	provenance: {
		runner: string;
		capturedAt: string;
		source: { revision: string | null; dirty: boolean | null } | null;
	};
	/** A run that failed; the report then has no summary. */
	error?: string;
}
export interface ProfileRun {
	reports: ProfileReport[];
	counts: {
		total: number;
		passed: number;
		warnings: number;
		failed: number;
		notComparable: number;
		noBaseline: number;
		errored: number;
	};
	/** Recorded baselines that name no current entry, such as after a story was renamed. */
	orphanedBaselines: string[];
	elapsedMs: number;
}
/** One value per axis gives a cell; a cell is every axis's combination. */
export interface MatrixAxes {
	theme?: string[];
	viewport?: { width: number; height: number }[];
	container?: { width: number; height?: number }[];
	locale?: string[];
	reducedMotion?: ('reduce' | 'no-preference')[];
	motion?: ('natural' | 'settled')[];
}
export interface MatrixRequest {
	id: string;
	axes: MatrixAxes;
	checkpoint?: string;
	/** What every cell shares. An axis takes precedence over it. */
	context?: Partial<SpecimenContext>;
	timeoutMs?: number;
	workers?: number;
	/** Keep each cell's observation. A capture is large, so the default keeps only the diff. */
	observations?: boolean;
}
export interface MatrixCell {
	/** This cell's value on each axis. */
	context: Partial<SpecimenContext>;
	/** `unavailable`: no capture could be made for this cell, and `reason` says why. */
	status: 'captured' | 'unavailable';
	reason?: string;
	/** Compared with the first captured cell; `null` for that cell, or one with no capture. */
	diff: {
		status: ObservationDiff['status'];
		channels: string[];
		differences: number;
		limitations: string[];
	} | null;
	observation?: Observation;
}
export interface MatrixRun {
	id: string;
	checkpoint: string;
	axes: string[];
	cells: MatrixCell[];
	counts: {
		total: number;
		captured: number;
		unavailable: number;
		changed: number;
		unchanged: number;
		insufficient: number;
	};
	elapsedMs: number;
}
/** What a retained story's run found: the play, then the accessibility check. */
export interface StoryOutcome {
	/** `excluded`: no test exists for the story under the include and exclude tags. */
	status: 'passed' | 'failed' | 'skipped' | 'excluded';
	play: 'ran' | 'none';
	failures: { category: 'render' | 'play' | 'a11y'; message: string }[];
	a11y: AxeOutcome;
}
export interface BrowserRuntime {
	/**
	 * A retained story's render context, settled from its own annotations and the request;
	 * `null` for a native specimen, whose context the request already settles.
	 */
	resolve(
		entry: SpecimenEntry,
		requested: Partial<SpecimenContext>,
		defaults: SpecimenContext,
		options?: { check?: boolean }
	): Promise<{ context: SpecimenContext; limitations: string[] } | null>;
	mount(
		entry: SpecimenEntry,
		context: SpecimenContext
	): Promise<{
		targets: Record<string, Target>;
		scenario: ScenarioStep[];
		events: EventDeclaration[];
	}>;
	/** Check what is mounted, at this point: a retained story under its policy, or a specimen. */
	checkAccessibility(): Promise<AxeOutcome>;
	/** A declared event target's element, once the host has resolved it. */
	bindEventTarget(name: string, element: Element): void;
	stepStarted(id: string | null): void;
	/** Hold an expectation; the host resolves an element expectation's target first. */
	expect(expectation: Expectation, element?: Element): Promise<void>;
	/** What a profile reads from the page at its checkpoint. */
	profileMetrics(): Promise<Record<string, number | null>>;
	/** Render a retained story, then run its play and accessibility check, with no task between. */
	mountAndRun(entry: SpecimenEntry, context: SpecimenContext): Promise<StoryOutcome>;
	/** Resolve an entry without rendering it: args, context and the component's enriched schema. */
	inspect(
		entry: SpecimenEntry,
		requested: Partial<SpecimenContext>,
		defaults: SpecimenContext,
		manifestSchema: ComponentSchema | null
	): Promise<InspectResult>;
	/** Run a command through a plugin's named runner. */
	command(element: Element, runner: string, name: string, input: unknown): Promise<unknown>;
	capture(): BrowserObservation;
	/** Elements under the mount root matching a selector target, across open shadow roots. */
	locate(selector: string): Element[];
	/** `normalizeDom` run in the page, so the caller's process does not parse captures. */
	normalize(html: string): Promise<string>;
	dispose(): Promise<void>;
}
declare global {
	interface Window {
		__specimen: BrowserRuntime;
	}
}

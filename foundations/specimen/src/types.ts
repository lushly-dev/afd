import type { ComponentSchema } from './plugin.js';

/** Public contracts: native specimens, retained stories and their plugins. */
export const CAPTURE_VERSION = '0.2' as const;
export const NORMALIZATION_VERSION = '0.1' as const;

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
	| { capture: string };
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
	 * Which retained stories run, as the Storybook Vitest addon's `tags` option selects them:
	 * `include` defaults to `['test']`; `skip` reports a story skipped without running it.
	 */
	test?: { include?: string[]; exclude?: string[]; skip?: string[] };
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
		imports: { source: string; names: string[]; typeOnly: boolean; reason: string }[];
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
	};
	/** Requested context that the entry does not get, and other limits of what was resolved. */
	limitations: string[];
	/** The plugins installed, by id, with the runners and themes they register. */
	plugins: { id: string; runners: string[]; themes: string[]; tokens: string | null }[];
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
}
export interface CaptureManifest {
	captureVersion: string;
	normalizationVersion: string;
	specimenId: string;
	checkpoint: string;
	source: { revision: string | null; digest: string; dirty: boolean | null };
	dependencies: string;
	browser: { name: string; version: string };
	context: SpecimenContext;
}
export interface Observation {
	manifest: CaptureManifest;
	channels: {
		dom: { raw: string; normalized: string };
		a11y: { snapshot: string; axe: 'not-run' };
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
	channel: 'dom' | 'a11y' | 'layout' | 'styles' | 'state';
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
/** What a retained story's run found: the play, then the accessibility check. */
export interface StoryOutcome {
	/** `excluded`: no test exists for the story under the include and exclude tags. */
	status: 'passed' | 'failed' | 'skipped' | 'excluded';
	play: 'ran' | 'none';
	failures: { category: 'render' | 'play' | 'a11y'; message: string }[];
	a11y: {
		/** `warning`: violations under `parameters.a11y.test: 'todo'`. */
		status: 'passed' | 'warning' | 'failed' | 'not-run';
		policy: 'error' | 'todo' | 'off' | 'disabled' | 'manual';
		reason?: string;
		violations: { id: string; impact: string | null; help: string; targets: string[] }[];
		incomplete: number;
		engine?: string;
	};
}
export interface BrowserRuntime {
	/**
	 * A retained story's render context, settled from its own annotations and the request;
	 * `null` for a native specimen, whose context the request already settles.
	 */
	resolve(
		entry: SpecimenEntry,
		requested: Partial<SpecimenContext>,
		defaults: SpecimenContext
	): Promise<{ context: SpecimenContext; limitations: string[] } | null>;
	/** `settle: false` mounts a retained story without waiting for fonts and a frame, as its runner does. */
	mount(
		entry: SpecimenEntry,
		context: SpecimenContext,
		options?: { settle?: boolean }
	): Promise<{ targets: Record<string, Target>; scenario: ScenarioStep[] }>;
	/** Run the mounted retained story's play and accessibility check. */
	run(): Promise<StoryOutcome>;
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

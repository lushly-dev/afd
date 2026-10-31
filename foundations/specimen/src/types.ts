/** Public feasibility contracts; compatibility/plugins are later workstreams. */
export const CAPTURE_VERSION = '0.1' as const;
export const NORMALIZATION_VERSION = '0.1' as const;

export interface SpecimenContext {
	viewport: { width: number; height: number };
	container?: { width: number; height?: number };
	theme: 'light' | 'dark';
	locale: string;
	reducedMotion: 'reduce' | 'no-preference';
	motion: 'natural' | 'settled';
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
	module: string;
	exportName: string;
	component?: string;
}
export interface BenchConfig {
	specimens: SpecimenEntry[];
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
export interface BrowserRuntime {
	mount(
		entry: SpecimenEntry,
		context: SpecimenContext
	): Promise<{ targets: Record<string, Target>; scenario: ScenarioStep[] }>;
	capture(): BrowserObservation;
	dispose(): Promise<void>;
}
declare global {
	interface Window {
		__specimen: BrowserRuntime;
	}
}

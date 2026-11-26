/** Contracts for modality-enforced persona walks (`panel-walk`, Agent-First Design Phase C1). */

export type Modality = 'pointer' | 'keyboard' | 'screen-reader' | 'low-vision';

export const MODALITY_VALUES = ['pointer', 'keyboard', 'screen-reader', 'low-vision'] as const;

export const WALK_ID_LENGTH = 12;
export const WALK_ID_PATTERN = /^walk-[0-9a-hjkmnp-tv-z]{12}$/;
export const DEFAULT_WALK_MAX_ACTIONS = 60;
export const MAX_WALK_ACTIONS = 500;
export const DEFAULT_WALK_TIMEOUT_MS = 30 * 60 * 1000;
export const WALKS_DIR = 'walks';

export interface WalkUnmeasuredEntry {
	area: string;
	reason: string;
	addToMeasure: string;
}

export interface PersonaDefinition {
	id: string;
	modality: Modality;
	name?: string;
	stance?: string;
	card?: string;
}

export interface PanelConfig {
	personas?: PersonaDefinition[];
	jobs?: string[];
	scenariosDir?: string;
	/** Optional relative JS/ESM module exporting a default `PanelWalkDriver`. */
	driver?: string;
}

export interface ModalityToolPolicy {
	modality: Modality;
	viewport: { width: number; height: number };
	showsScreenshot: boolean;
	allowedTools: readonly string[];
	forbiddenTools: readonly string[];
}

/**
 * Universal tools denied to every persona regardless of modality (Phase 0 `personas/README.md`).
 * Personas perceive and act only as a person of their modality does.
 */
export const UNIVERSAL_FORBIDDEN_TOOLS = [
	'dom_query',
	'a11y_tree',
	'selector',
	'eval',
	'journal',
	'find_by_name',
] as const;

/** Exact per-modality perception and action tool policy from Phase 0 `bench/held/personas/README.md`. */
export const MODALITY_TOOL_POLICIES: Record<Modality, ModalityToolPolicy> = {
	pointer: {
		modality: 'pointer',
		viewport: { width: 1280, height: 800 },
		showsScreenshot: true,
		allowedTools: ['screenshot', 'click', 'double_click', 'scroll', 'type'],
		forbiddenTools: [...UNIVERSAL_FORBIDDEN_TOOLS, 'press', 'sr_read', 'sr_move', 'sr_jump'],
	},
	keyboard: {
		modality: 'keyboard',
		viewport: { width: 1280, height: 800 },
		showsScreenshot: true,
		allowedTools: ['screenshot', 'press', 'type'],
		forbiddenTools: [
			...UNIVERSAL_FORBIDDEN_TOOLS,
			'click',
			'double_click',
			'scroll',
			'sr_read',
			'sr_move',
			'sr_jump',
		],
	},
	'screen-reader': {
		modality: 'screen-reader',
		viewport: { width: 1280, height: 800 },
		showsScreenshot: false,
		allowedTools: ['sr_read', 'sr_move', 'sr_jump', 'press', 'type'],
		forbiddenTools: [...UNIVERSAL_FORBIDDEN_TOOLS, 'screenshot', 'click', 'double_click', 'scroll'],
	},
	'low-vision': {
		modality: 'low-vision',
		viewport: { width: 320, height: 800 },
		showsScreenshot: true,
		allowedTools: ['screenshot', 'click', 'scroll', 'press', 'type'],
		forbiddenTools: [...UNIVERSAL_FORBIDDEN_TOOLS, 'double_click', 'sr_read', 'sr_move', 'sr_jump'],
	},
};

export interface WalkJournalEntry {
	command: string;
	recordId?: string;
	mutation?: boolean;
	success: boolean;
	/** Refusal explicitly expected by the scenario steps (counts as a step, not a failure). */
	expectedRefusal?: boolean;
	/** Undoes an earlier mutation (counts as a repeat per Phase 0 `walks.md`). */
	undo?: boolean;
	/** Read-only query (free on success, counts as failed if `success === false`). */
	readOnly?: boolean;
}

export interface WalkFinding {
	summary: string;
	evidence: 'observed' | 'hypothesis';
	where: string;
}

export interface WalkPathMetrics {
	done: boolean;
	failed: number;
	repeats: number;
	outside: number;
	deviations: number;
}

export interface WalkPairwiseComparison {
	baselineWalk: string;
	method: 'blind-pairwise-report';
	worse: 'current' | 'baseline' | 'same';
	why: string;
}

export interface PanelWalkRequest {
	job: string;
	persona: string;
	modality: Modality;
	target: string;
	appDate?: string;
	maxActions?: number;
	baselineWalk?: string;
	requestedTools?: string[];
}

export interface PanelWalkResult {
	walk: string;
	job: string;
	persona: string;
	modality: Modality;
	ending: 'done' | 'stopped';
	actions: number;
	path: WalkPathMetrics;
	findings: WalkFinding[];
	comparison?: WalkPairwiseComparison;
	unmeasured: WalkUnmeasuredEntry[];
}

export interface PanelWalkRecord {
	version: 1;
	walk: string;
	recordedUtc: string;
	target: string;
	appDate?: string;
	viewport: { width: number; height: number };
	allowedTools: string[];
	prompt: string;
	endingLine: string;
	transcript: string;
	journal: WalkJournalEntry[];
	expectedSteps: string[];
	result: PanelWalkResult;
}

export interface ModalityToolbox {
	readonly modality: Modality;
	readonly allowedTools: readonly string[];
	readonly viewport: { width: number; height: number };
	readonly showsScreenshot: boolean;
	invoke(tool: string, input?: Record<string, unknown>): Promise<unknown>;
	readonly calls: ReadonlyArray<{ tool: string; input?: Record<string, unknown> }>;
}

export interface PanelWalkDriverContext {
	job: string;
	script: string;
	expectedSteps: string[];
	persona: PersonaDefinition;
	modality: Modality;
	target: string;
	appDate?: string;
	maxActions: number;
	prompt: string;
	toolbox: ModalityToolbox;
	signal?: AbortSignal;
	allowedOrigins?: readonly string[];
}

export interface BlindWalkJudgeInput {
	reportA: string;
	reportB: string;
}

export interface BlindWalkJudgeResult {
	worse: 'A' | 'B' | 'same';
	why: string;
}

export type BlindWalkJudge = (input: BlindWalkJudgeInput) => BlindWalkJudgeResult;

export interface PanelWalkDriverResult {
	transcript: string;
	actions?: number;
	journal?: WalkJournalEntry[];
	findings: WalkFinding[];
}

export type PanelWalkDriver = (context: PanelWalkDriverContext) => Promise<PanelWalkDriverResult>;

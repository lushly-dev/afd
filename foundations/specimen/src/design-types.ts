/** Contracts for AFD default result-state patterns and the `design-states` command (Phase B1). */

export type ApprovalStatus = 'proposed' | 'approved' | 'deprecated';

export interface UnmeasuredEntry {
	area: string;
	reason: string;
	addToMeasure: string;
}

export const DEFAULT_PATTERNS_LIBRARY = 'afd-defaults' as const;
export const DEFAULT_PATTERNS_SEMVER = '1.0.0' as const;
export const DEFAULT_PATTERNS_VERSION =
	`${DEFAULT_PATTERNS_LIBRARY}@${DEFAULT_PATTERNS_SEMVER}` as const;

/** Canonical `afd-defaults@1.0.0` result-state pattern IDs in alphabetical order. */
export const CANONICAL_DEFAULT_PATTERNS = [
	'alternatives-and-confidence',
	'approval-request',
	'batch-partial-failure',
	'collection-states',
	'destructive-confirm',
	'error-recovery',
	'evidence-and-sources',
	'progress-and-plan',
	'undo-offer',
	'warnings-banner',
] as const;

export type CanonicalDefaultPatternId = (typeof CANONICAL_DEFAULT_PATTERNS)[number];

export interface CommandManifestStateDeclaration {
	/** Optional explicit state id (defaults to the resolved pattern id). */
	id?: string;
	/** Contract field or refusal code triggering this state. */
	trigger: string;
	/** Pattern id (`<pattern>` under `afd-defaults`, or `<library>/<pattern>`). */
	pattern: string;
	/** Wire fixture path or scenario step forcing this state. */
	setup?: string;
}

export interface CommandManifestErrorEntry {
	code: string;
	retryable?: boolean;
	message?: string;
}

export interface CommandManifestEntry {
	name: string;
	description?: string;
	mutation?: boolean;
	undoable?: boolean;
	destructive?: boolean;
	confirmPrompt?: string;
	approval?: boolean | Record<string, unknown>;
	executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';
	batch?: boolean;
	returnsCollection?: boolean;
	returnsPlan?: boolean;
	returnsAlternatives?: boolean;
	returnsConfidence?: boolean;
	returnsSources?: boolean;
	returnsReasoning?: boolean;
	returnsWarnings?: boolean;
	errors?: Array<string | CommandManifestErrorEntry>;
	states?: CommandManifestStateDeclaration[];
}

export interface CommandManifest {
	app?: string;
	defaultsVersion?: string;
	localLibrary?: string;
	consumer?: string;
	commands: Array<string | CommandManifestEntry>;
}

export type DesignStateSource = 'default' | 'copied' | 'replaced' | 'product';

export interface DesignStateEntry {
	id: string;
	command: string;
	trigger: string;
	pattern: string;
	source: DesignStateSource;
	approvalStatus: ApprovalStatus;
	setup: string;
}

export interface DesignStatesRequest {
	commands?: string[];
	scenario?: string;
	consumer?: string;
	includeProposed?: boolean;
	limit?: number;
	after?: string;
}

export interface DesignStatesResult {
	defaultsVersion: string;
	states: DesignStateEntry[];
	next?: string;
	nextSteps: string[];
	unmeasured: UnmeasuredEntry[];
}

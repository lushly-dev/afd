/** Contracts for Agent-First Design decision cards (`design-card-list`) and release manifests (`design-release`). */

export const CARD_ID_LENGTH = 12;
export const CARD_ID_PATTERN = /^card-[0-9a-hjkmnp-tv-z]{12}$/;
export const CARDS_DIR = 'specimens/cards';
export const RELEASES_DIR = 'specimens/releases';
export const RELEASE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type RefusalScope = 'unsafe' | 'wrong-for-context' | 'not-a-priority';
export const REFUSAL_SCOPE_VALUES = ['unsafe', 'wrong-for-context', 'not-a-priority'] as const;

export type CardScope = 'release' | 'guidance' | 'interface';
export const CARD_SCOPE_VALUES = ['release', 'guidance', 'interface'] as const;

export type CardOwner = 'default' | 'company' | 'product';
export const CARD_OWNER_VALUES = ['default', 'company', 'product'] as const;

export type CardSeverity = 'blocker' | 'major' | 'minor';
export const CARD_SEVERITY_VALUES = ['blocker', 'major', 'minor'] as const;

export type EscalationTrigger =
	| 'split-3-to-2'
	| 'conflicts-recorded-decision'
	| 'no-precedent'
	| 'guidance-change'
	| 'irreversible-or-default';

export type CardTrigger = EscalationTrigger | 'pre-ship-release' | 'keep-waiver';
export const CARD_TRIGGER_VALUES = [
	'split-3-to-2',
	'conflicts-recorded-decision',
	'no-precedent',
	'guidance-change',
	'irreversible-or-default',
	'pre-ship-release',
	'keep-waiver',
] as const;

export type CardStatus =
	| 'open'
	| 'provisional'
	| 'approved'
	| 'changes-requested'
	| 'rejected'
	| 'deferred'
	| 'withdrawn';
export const CARD_STATUS_VALUES = [
	'open',
	'provisional',
	'approved',
	'changes-requested',
	'rejected',
	'deferred',
	'withdrawn',
] as const;

export type CardChosen = 'approve' | 'request-changes' | 'reject' | 'defer';
export const CARD_CHOSEN_VALUES = ['approve', 'request-changes', 'reject', 'defer'] as const;

export interface MeantToFix {
	job: string;
	target: string;
}

export interface CardUnmeasuredEntry {
	area: string;
	reason: string;
	addToMeasure: string;
}

export interface CardVisual {
	kind: 'captures' | 'transcript' | 'diff';
	before?: string;
	after?: string;
	context?: {
		state?: string;
		viewport?: string;
		theme?: string;
		modality?: 'pointer' | 'keyboard' | 'screen-reader' | 'low-vision';
	};
	summary: string;
}

export interface CardWhy {
	findings: Array<{ summary: string; evidence: 'observed' | 'hypothesis' }>;
	evidenceForBothSides?: { for: string[]; against: string[] };
	reviewerCount: number;
	split: string;
	trigger: CardTrigger;
}

export interface CardEffect {
	gatesBefore: { passed: number; failed: number };
	gatesAfter: { passed: number; failed: number };
	checksSummary?: string;
	regression: boolean;
}

export interface CardRisk {
	affects: string[];
	undoable: boolean;
}

/** Optional atomic pattern action executed when a guidance card is approved via `decision-record`. */
export type CardPatternAction =
	| {
			kind: 'fork';
			library: string;
			pattern: string;
			patternPath: string;
			source?: string;
			bind?: boolean;
			configPath?: string;
	  }
	| {
			kind: 'merge';
			library: string;
			pattern: string;
			patternPath: string;
			upstreamLibrary: string;
			upstreamPattern: string;
			upstreamVersion: string;
			upstreamDigests: Record<string, string>;
			/** Required path to the authoritative upstream pattern.json used for staleness verification. */
			upstreamPath: string;
			stagedPattern: Record<string, unknown>;
	  };

/** On-disk decision card record stored at `specimens/cards/<card>.json`. */
export interface DesignCardRecord {
	card: string;
	run?: string;
	scope: CardScope;
	what: string;
	owner: CardOwner;
	touches: string[];
	severity: CardSeverity;
	visual: CardVisual;
	why: CardWhy;
	effect: CardEffect;
	risk: CardRisk;
	status: CardStatus;
	/** Stable signature of the proposed change, matched against `refusalScope: 'unsafe'` decisions. */
	changeSignature?: string;
	patternAction?: CardPatternAction;
	decision?: string;
	createdAt?: string;
}

/** Public view of a decision card returned by `design-card-list`. */
export interface DesignCardSummary {
	card: string;
	run?: string;
	what: string;
	owner: CardOwner;
	touches: string[];
	severity: CardSeverity;
	visual: CardVisual;
	why: CardWhy;
	effect: CardEffect;
	risk: CardRisk;
	status: CardStatus;
}

export interface DesignCardListRequest {
	scope?: 'all' | CardScope;
	card?: string;
	status?: 'open' | 'deferred' | 'changes-requested' | 'withdrawn' | 'all';
	severity?: CardSeverity;
	includeProvisional?: boolean;
	includeDecided?: boolean;
	limit?: number;
	after?: string;
}

export interface DesignCardListResult {
	page: string;
	cards: DesignCardSummary[];
	total: number;
	more: number;
	next?: string;
	unmeasured: CardUnmeasuredEntry[];
}

export interface DesignReleaseRequest {
	release: string;
	decisions: string[];
	scope?: 'all' | CardScope;
	releasedAt?: string;
}

export interface DesignReleaseManifest {
	version: 1;
	release: string;
	scope: 'all' | CardScope;
	releasedAt: string;
	decisions: string[];
	releasedBy: {
		kind: 'person' | 'test';
		id?: string;
		channel?: 'review-page' | 'cli' | 'mcp-relay';
	};
}

export interface DesignReleaseResult {
	release: string;
	manifestPath: string;
	releasedAt: string;
	decisions: string[];
	nextSteps: string[];
	unmeasured: CardUnmeasuredEntry[];
}

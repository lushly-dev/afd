import type { DecisionActor, DecisionAnswerCause } from './decision-types.js';

/** Request to `specimen-review` over two saved capture sets or local labels. */
export interface ReviewRequest {
	/** Set id (`set-...`) or local label for the baseline capture set. */
	before: string;
	/** Set id (`set-...`) or local label for the candidate capture set. */
	after: string;
	/** Optional exact specimen ids or `<id>` job prefixes to scope the review. */
	ids?: string[];
}

/** Compact provenance summary for one side of a review. */
export interface ReviewSetSummary {
	set: string;
	label?: string;
	revision: string | null;
	dirty: boolean | null;
}

/** Before/after artifact references attached to one open review item. */
export interface ReviewCaptureRef {
	key: string;
	before?: string;
	after: string;
}

/** Matching current choice decision surfaced on a `changed` review item. */
export interface ReviewDecisionRef {
	decision: string;
	reason: string;
}

/** One open review item that no automated gate or prior answer has settled. */
export interface ReviewOpenItem {
	item: string;
	kind: 'changed' | 'incomplete-check' | 'insufficient-evidence';
	ids: string[];
	cause?: DecisionAnswerCause;
	check?: string;
	limitation?: string;
	question: string;
	options: ['accept', 'reject'];
	captures: ReviewCaptureRef[];
	decisions: ReviewDecisionRef[];
	/** Guidance reminding agents that open review items belong to the human reviewer. */
	note?: string;
}

/** One blocking item that the agent must resolve before review can go quiet. */
export interface ReviewBlockingItem {
	kind: 'axe-failed' | 'unavailable' | 'rejected';
	ids: string[];
	item?: string;
	reason?: string;
	violations?: string[];
}

/** Counts of captures and review items settled without human attention. */
export interface ReviewSettledCounts {
	/** Captures with axe passed (no incomplete checks) and `no-change-observed`. */
	unchanged: number;
	/** Captures excluded first because they are kept, unchosen variants of a current choice. */
	kept: number;
	/** Review items settled by an accepted answer or choice's `answers` with matching fingerprint. */
	answered: number;
}

/** Result of `specimen-review`. */
export interface ReviewResult {
	before: ReviewSetSummary;
	after: ReviewSetSummary;
	open: ReviewOpenItem[];
	blocking: ReviewBlockingItem[];
	settled: ReviewSettledCounts;
	page: string;
}

/** Summary of a matched answer/choice decision shown on `review.html` (including actor badge). */
export interface ReviewPageAnswerSummary {
	decision: string;
	kind: 'choice' | 'answer';
	chosen: string;
	item: string;
	ids: string[];
	reason: string;
	decidedAt: string;
	decidedBy: DecisionActor;
	status: 'answered' | 'rejected';
}

/** Safe image reference for `review.html` (never exposing raw Observation payloads). */
export interface ReviewPageCapturePreview {
	key: string;
	beforeScreenshot: string | null;
	afterScreenshot: string | null;
}

/** Enriched payload served to `review.html?before=&after=`. */
export interface ReviewPageData extends ReviewResult {
	/** Context theme of the reviewed capture sets for page chrome styling. */
	theme: string;
	/** Previews keyed by open item id so `review.html` can render before/after screenshots. */
	previews: Record<string, ReviewPageCapturePreview[]>;
	/** Matched answers (both settled accepts and blocking rejections) with `decidedBy` provenance. */
	matchedAnswers: ReviewPageAnswerSummary[];
}

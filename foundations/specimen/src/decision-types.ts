import type { CardChosen, MeantToFix, RefusalScope } from './card-types.js';
import type {
	AxeOutcome,
	CaptureSetManifest,
	ChannelDifference,
	SpecimenContext,
} from './types.js';

/** Provenance kind of the actor who recorded a design decision. */
export type DecisionActorKind = 'person' | 'panel' | 'script' | 'test';
/** Provenance metadata recorded on a design decision file. */
export interface DecisionActor {
	kind: DecisionActorKind;
	id?: string;
	channel?: 'review-page' | 'cli' | 'mcp-relay';
	reviewers?: string[];
	split?: string;
}
/** Code, specimen, and token subjects covered by a choice decision. */
export interface DecisionSubjects {
	specimens?: string[];
	files?: string[];
	tokens?: string[];
}
/** Pointer from a choice decision to its committed evidence directory. */
export interface DecisionEvidenceRef {
	set: string;
	dir: string;
}
/** One capture entry committed inside `specimens/evidence/<setId>/manifest.json`. */
export interface DecisionEvidenceCapture {
	key: string;
	id: string;
	status: 'captured' | 'unavailable';
	hash: string | null;
	checkpoint?: string;
	axe: AxeOutcome['status'];
	violations?: string[];
	screenshot: string | null;
	reason?: string;
}
/** Committed evidence manifest stored at `specimens/evidence/<setId>/manifest.json`. */
export interface DecisionEvidenceManifest {
	version: 1;
	set: string;
	kind: CaptureSetManifest['kind'];
	context: SpecimenContext;
	checkpoint: string;
	revision: string | null;
	dirty: boolean | null;
	captures: DecisionEvidenceCapture[];
}
/** Structured cause recorded on an answered review item. */
export interface DecisionAnswerCause {
	channel: ChannelDifference['channel'];
	target?: string;
	property?: string;
	left?: unknown;
	right?: unknown;
}
/** Fingerprint-scoped record of one answered review item. */
export interface DecisionAnswerEntry {
	item: string;
	kind?: 'changed' | 'incomplete-check' | 'insufficient-evidence';
	id?: string;
	ids?: string[];
	check?: string;
	cause?: DecisionAnswerCause;
	fingerprint: string;
}
/** On-disk choice decision stored at `specimens/decisions/<id>.json`. */
export interface ChoiceDecisionRecord {
	id: string;
	kind: 'choice';
	slug: string;
	status: 'current' | 'superseded';
	question: string;
	variants: string[];
	chosen: string;
	kept: string[];
	discarded: string[];
	discardedAt?: Record<string, string>;
	reason: string;
	evidence: DecisionEvidenceRef;
	subjects: DecisionSubjects;
	answers?: DecisionAnswerEntry[];
	supersedes?: string;
	decidedAt: string;
	decidedBy: DecisionActor;
}
/** On-disk answer decision stored at `specimens/decisions/<id>.json` (never carries subjects). */
export interface AnswerDecisionRecord {
	id: string;
	kind: 'answer';
	slug?: string;
	question?: string;
	chosen: 'accept' | 'reject';
	reason: string;
	answers: DecisionAnswerEntry[];
	provisional?: true;
	decidedAt: string;
	decidedBy: DecisionActor;
}
/** On-disk decision card outcome stored at `specimens/decisions/<id>.json`. */
export interface CardDecisionRecord {
	id: string;
	kind: 'card';
	card: string;
	question: string;
	chosen: CardChosen;
	reason: string;
	refusalScope?: RefusalScope;
	regressionAccepted?: boolean;
	meantToFix?: MeantToFix;
	supersedes?: string;
	remediation?: string;
	changeSignature?: string;
	appliedPatterns?: string[];
	decidedAt: string;
	decidedBy: DecisionActor;
}
/** Union of committed design decision records. */
export type DecisionRecord = ChoiceDecisionRecord | AnswerDecisionRecord | CardDecisionRecord;

/** Panel provenance supplied on provisional Mode 3 review answers. */
export interface DecisionPanelProvenance {
	reviewers: string[];
	split: string;
}

/** Request to `decision-record` across its four input modes (`set`, `supersedes`, `items`, or `card`/`cards`). */
export interface DecisionRecordRequest {
	slug?: string;
	question?: string;
	set?: string;
	supersedes?: string | string[];
	items?: string[];
	card?: string;
	cards?: string[];
	chosen: string;
	reason?: string;
	subjects?: DecisionSubjects;
	refusalScope?: RefusalScope;
	regressionAccepted?: boolean;
	meantToFix?: MeantToFix;
	remediation?: string;
	provisional?: boolean;
	panel?: DecisionPanelProvenance;
	changeAuthor?: string;
}
/** Single decision returned by `decision-record`. */
export interface DecisionRecordSingleResult {
	decision: string;
	kind: 'choice' | 'answer' | 'card';
	path: string;
	chosen: string;
	card?: string;
	kept?: string[];
	supersedes?: string;
	superseded?: string;
	answers?: DecisionAnswerEntry[];
	evidence?: DecisionEvidenceRef;
	evidenceDir?: string;
	subjects?: DecisionSubjects;
	refusalScope?: RefusalScope;
	regressionAccepted?: boolean;
	meantToFix?: MeantToFix;
	appliedPatterns?: string[];
	provisional?: true;
}
/** Multi-decision result returned by `decision-record` for multi-choice `supersedes` or batch `cards`. */
export interface DecisionRecordMultiResult {
	decisions: DecisionRecordSingleResult[];
}
/** Result of `decision-record`. */
export type DecisionRecordResult = DecisionRecordSingleResult | DecisionRecordMultiResult;
/** Request to `decision-get`. */
export interface DecisionGetRequest {
	decision: string;
}
/** Choice decision returned by `decision-get`, enriched with committed evidence captures. */
export interface ChoiceDecisionGetResult extends Omit<ChoiceDecisionRecord, 'evidence'> {
	decision: string;
	evidence: DecisionEvidenceRef & {
		captures: DecisionEvidenceCapture[];
	};
}
/** Answer decision returned by `decision-get`. */
export interface AnswerDecisionGetResult extends AnswerDecisionRecord {
	decision: string;
}
/** Card decision returned by `decision-get`. */
export interface CardDecisionGetResult extends CardDecisionRecord {
	decision: string;
}
/** Result of `decision-get`. */
export type DecisionGetResult =
	| ChoiceDecisionGetResult
	| AnswerDecisionGetResult
	| CardDecisionGetResult;
/** Request filters for `decision-list`. */
export interface DecisionListRequest {
	kind?: 'choice' | 'card' | 'answer' | 'all';
	released?: boolean;
	limit?: number;
	after?: string;
}
/** One decision entry returned by `decision-list`. */
export interface DecisionListEntry {
	decision: string;
	question: string;
	chosen: string;
	stale: string[];
	kind?: 'choice' | 'card' | 'answer';
	card?: string;
	released?: boolean;
	release?: string;
	refusalScope?: RefusalScope;
	meantToFix?: MeantToFix;
}
/** One comparison capture set not yet cited by any decision. */
export interface UndecidedComparison {
	set: string;
	ids: string[];
}
/** Result of `decision-list`. */
export interface DecisionListResult {
	decisions: DecisionListEntry[];
	undecided: UndecidedComparison[];
	total?: number;
	next?: string;
}
/** Request to `decision-check` before editing files, specimens, or tokens. */
export interface DecisionCheckRequest {
	files?: string[];
	specimens?: string[];
	tokens?: string[];
}
/** Which query subjects matched a current choice in `decision-check`. */
export interface DecisionCheckMatch {
	files?: string[];
	specimens?: string[];
	tokens?: string[];
}
/** One matching current choice returned by `decision-check`. */
export interface DecisionCheckEntry {
	decision: string;
	question: string;
	chosen: string;
	reason: string;
	supersedes?: string;
	matched: DecisionCheckMatch;
}
/** Result of `decision-check`. */
export interface DecisionCheckResult {
	decisions: DecisionCheckEntry[];
}
/** Resolved review item supplied to `recordDecision` when validating `items` against `specimen-review`. */
export interface ResolvedReviewItem {
	entry: DecisionAnswerEntry;
	afterSet: string;
	touchedChoices: string[];
	question: string;
}
/** Execution options for `recordDecision` (actor provenance and optional review-item resolver). */
export interface RecordDecisionOptions {
	decidedBy?: DecisionActor;
	/** Set to true when confirmed via HumanRelay or interactive person confirmation. */
	humanConfirmed?: boolean;
	/** Invoking actor kind from AFD context (e.g. 'agent' | 'human' | 'person' | 'script' | 'service' | 'test'). */
	invokingActorKind?: 'person' | 'human' | 'agent' | 'script' | 'service' | 'test';
	/** Invoking actor id for server-side `AUTHOR_CANNOT_DECIDE` enforcement. */
	actorId?: string;
	/** Author of the change under review (derived server-side when available). */
	changeAuthor?: string;
	/** Optional map of cardId -> sha256 content digest pinned when HumanRelay confirmation began. */
	expectedCardDigests?: Readonly<Record<string, string>>;
	now?: () => Date;
	resolveReviewItem?: (item: string) => Promise<ResolvedReviewItem>;
}

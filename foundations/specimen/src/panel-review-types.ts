/**
 * Contracts for multi-persona panel orchestration (`panel-review`) and blind calibration
 * (`panel-calibrate`, Agent-First Design Phase C3, #2563).
 */

import type { EscalationTrigger } from './card-types.js';
import type { UnmeasuredEntry } from './design-types.js';
import type { BlindWalkJudge, PanelWalkDriver } from './panel-types.js';

export const RUN_ID_LENGTH = 12;
export const RUN_ID_PATTERN = /^run-[0-9a-hjkmnp-tv-z]{12}$/;
export const SAMPLE_ID_LENGTH = 12;
export const SAMPLE_ID_PATTERN = /^cal-[0-9a-hjkmnp-tv-z]{12}$/;
export const PANEL_RUNS_DIR = 'panel-runs';
export const PANEL_CALIBRATIONS_DIR = 'panel-calibrations';
export const DEFAULT_PANEL_SIZE = 5;
export const MAX_PANEL_SIZE = 15;
export const DEFAULT_CALIBRATION_COUNT = 5;
export const MAX_CALIBRATION_COUNT = 100;

export type PanelReviewStoppedBy =
	| 'converged'
	| 'gate-regression'
	| 'budget'
	| 'no-new-findings'
	| null;

export interface PanelReviewBudget {
	maxRounds?: number;
	maxCostUsd?: number;
}

export interface PanelReviewCaptures {
	before?: string;
	after?: string;
}

export interface PanelReviewRunRequest {
	action?: 'review';
	change: string;
	author?: string;
	jobs: string[];
	target: string;
	appDate: string;
	captures?: PanelReviewCaptures;
	panelSize?: number;
	budget?: PanelReviewBudget;
	baseline?: string;
}

export interface PanelReviewWithdrawRequest {
	action: 'withdraw';
	run: string;
	reason: string;
}

export type PanelReviewRequest = PanelReviewRunRequest | PanelReviewWithdrawRequest;

export interface PanelReviewOverlap {
	families: string[];
	sharedFindings: number;
	uniqueFindings: number;
}

export interface PanelReviewProvisionalItem {
	item: string;
	summary: string;
	decidedBy: {
		kind: 'panel';
		reviewers: string[];
		split: string;
	};
	provisional: true;
}

export interface PanelReviewEscalatedItem {
	card: string;
	trigger: EscalationTrigger;
	split?: string;
	question: string;
	evidenceForBothSides: {
		for: string[];
		against: string[];
	};
}

export interface PanelReviewRunResult {
	run: string;
	round: number;
	panelSize: number;
	walks: string[];
	overlap: PanelReviewOverlap;
	provisional: PanelReviewProvisionalItem[];
	escalated: PanelReviewEscalatedItem[];
	stoppedBy: PanelReviewStoppedBy;
	nextSteps: string[];
	unmeasured: UnmeasuredEntry[];
}

export interface PanelReviewWithdrawResult {
	run: string;
	withdrawn: true;
	withdrawnCards: string[];
	withdrawnProvisional: number;
	preservedDecidedCards: string[];
	reason: string;
}

export type PanelReviewResult = PanelReviewRunResult | PanelReviewWithdrawResult;

/** Stored provisional agreement inside `.specimen/panel-runs/<run>.json`. */
export interface StoredProvisionalAgreement {
	item: string;
	summary: string;
	verdict: 'accept' | 'reject';
	decidedBy: {
		kind: 'panel';
		reviewers: string[];
		split: string;
	};
	evidence: {
		visual?: string;
		walk?: string;
	};
	decisionId?: string;
	withdrawn?: boolean;
}

/** On-disk panel review run record under `.specimen/panel-runs/<run>.json`. */
export interface PanelReviewRunRecord {
	version: 1;
	run: string;
	change: string;
	derivedAuthor?: string;
	round: number;
	panelSize: number;
	jobs: string[];
	target: string;
	appDate: string;
	captures?: PanelReviewCaptures;
	walks: string[];
	families: string[];
	costUsd: number;
	status: 'active' | 'withdrawn';
	createdAt: string;
	withdrawnAt?: string;
	withdrawnReason?: string;
	provisionalItems: StoredProvisionalAgreement[];
	escalatedCards: string[];
	findingKeys: string[];
}

export interface RunPanelReviewOptions {
	/** Verified caller identity (`ctx.actor.id`) used for server-side author independence checks. */
	actorId?: string;
	/** Optional host-minted server-derived change author (from `markSpecimenChangeAuthor`). */
	changeAuthor?: string;
	/** Optional walk driver override for tests or custom harness runs. */
	driver?: PanelWalkDriver;
	/** Optional walk timeout in milliseconds. */
	timeoutMs?: number;
	/** Optional abort signal. */
	signal?: AbortSignal;
	/** Optional blind judge for pairwise walk comparisons. */
	blindJudge?: BlindWalkJudge;
	/** Optional clock override. */
	now?: () => Date;
	/**
	 * Optional in-process Mode 3 provisional settlement hook (wired via `DirectRegistry` in
	 * `specimen-afd` when `captures.before` + `captures.after` are provided).
	 */
	recordProvisional?: (input: {
		items: string[];
		chosen: 'accept' | 'reject';
		reason: string;
		reviewers: string[];
		split: string;
		changeAuthor: string;
	}) => Promise<{ decision?: string } | undefined>;
}

export type CalibrationVerdict = 'accept' | 'reject';

export interface PanelCalibrateSampleRequest {
	action: 'sample';
	count?: number;
	seed?: number;
}

export interface PanelCalibrateJudgement {
	item: string;
	verdict: CalibrationVerdict;
	reason?: string;
}

export interface PanelCalibrateRecordRequest {
	action: 'record';
	sample: string;
	judgements: PanelCalibrateJudgement[];
}

export type PanelCalibrateRequest = PanelCalibrateSampleRequest | PanelCalibrateRecordRequest;

export interface PanelCalibrateEvidence {
	visual?: string;
	walk?: string;
}

export interface PanelCalibrateItem {
	item: string;
	summary: string;
	evidence: PanelCalibrateEvidence;
	/** Omitted during `action: 'sample'` (blind review); revealed during `action: 'record'`. */
	panelVerdict?: CalibrationVerdict;
}

export interface PanelCalibrateResult {
	sample: string;
	items: PanelCalibrateItem[];
	recorded?: number;
	disagreed?: number;
	disagreementRate?: number;
	reopenedCards?: string[];
	unmeasured: UnmeasuredEntry[];
}

/** Stored calibration sample under `.specimen/panel-calibrations/<sample>.json`. */
export interface PanelCalibrationSampleRecord {
	version: 1;
	sample: string;
	createdAt: string;
	seed?: number;
	status: 'open' | 'recorded';
	items: Array<{
		item: string;
		run: string;
		summary: string;
		evidence: PanelCalibrateEvidence;
		panelVerdict: CalibrationVerdict;
	}>;
	recordedAt?: string;
	judgements?: PanelCalibrateJudgement[];
	disagreed?: number;
	disagreementRate?: number;
	reopenedCards?: string[];
}

export interface RunPanelCalibrateOptions {
	/** Host-verified human confirmation (minted by `HumanRelay.approvedContext` or interactive UI). */
	humanConfirmed?: boolean;
	/** Invoking actor kind (`'person' | 'test' | 'script' | 'agent' | 'panel'`). */
	invokingActorKind?: 'person' | 'test' | 'script' | 'agent' | 'panel';
	/** Optional verified actor id. */
	actorId?: string;
	/** Optional clock override. */
	now?: () => Date;
}

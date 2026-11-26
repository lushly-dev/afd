/** Contracts for copied-pattern commands: `specimen-pattern-fork`, `specimen-pattern-compare`, `specimen-pattern-merge`. */

import type { UnmeasuredEntry } from './design-types.js';
import type { PatternDerivedFrom, WaivedKeepEntry } from './pattern-types.js';

export type PatternStatementSection = 'useWhen' | 'avoidWhen' | 'keep' | 'customize';

export type PatternCompareStatus =
	| 'unchanged'
	| 'changed-here'
	| 'changed-upstream'
	| 'changed-both'
	| 'dropped-here'
	| 'added-upstream'
	| 'declined';

export interface PatternForkRequest {
	/** Qualified upstream pattern `<library>/<pattern>`, e.g. `afd-defaults/error-recovery`. */
	source: string;
	/** Local target pattern id under `specimens/patterns/<target>/pattern.json` (defaults to source pattern id). */
	target?: string;
	/** When true, stages a pending `patternBindings` override applied atomically on card approval. */
	bind?: boolean;
}

export interface PatternForkResult {
	pattern: string;
	path: string;
	approvalStatus: 'proposed';
	derivedFrom: PatternDerivedFrom;
	bindingStatus: 'pending-approval' | 'unbound';
	card: string;
	nextSteps: string[];
}

export interface PatternCompareRequest {
	/** Local copied pattern id; omit for a bulk summary across all copied patterns. */
	pattern?: string;
	/** Optional upstream semver to compare against instead of the latest configured upstream version. */
	upstreamVersion?: string;
	/** When true (default), omits `unchanged` statements from single-pattern output. */
	onlyChanged?: boolean;
}

export interface PatternCompareSource {
	library: string;
	pattern: string;
	baseVersion: string;
	currentVersion: string;
}

export interface PatternCompareStatement {
	id: string;
	section: PatternStatementSection;
	status: PatternCompareStatus;
	waiverReason?: string;
	localText?: string;
	upstreamText?: string;
}

export interface PatternCompareSingleResult {
	pattern: string;
	source: PatternCompareSource;
	statements: PatternCompareStatement[];
	waivers: WaivedKeepEntry[];
	nextSteps: string[];
	unmeasured: UnmeasuredEntry[];
}

export interface PatternCompareBulkEntry {
	pattern: string;
	source: PatternCompareSource;
	counts: {
		changedHere: number;
		changedUpstream: number;
		changedBoth: number;
		droppedHere: number;
		addedUpstream: number;
		declined: number;
	};
	waivers: number;
}

export interface PatternCompareBulkResult {
	patterns: PatternCompareBulkEntry[];
	nextSteps: string[];
	unmeasured: UnmeasuredEntry[];
}

export type PatternCompareResult = PatternCompareSingleResult | PatternCompareBulkResult;

export interface PatternMergeResolution {
	id: string;
	text: string;
	gate?: string;
	setup?: string;
}

export interface PatternMergeRequest {
	pattern: string;
	upstreamVersion?: string;
	accept?: string[];
	decline?: string[];
	waivers?: WaivedKeepEntry[];
	resolutions?: PatternMergeResolution[];
}

export interface PatternMergeResult {
	pattern: string;
	card: string;
	upstreamVersion: string;
	upstreamDigests: Record<string, string>;
	accepted: string[];
	declined: string[];
	stagedStatus: 'proposed';
	nextSteps: string[];
}

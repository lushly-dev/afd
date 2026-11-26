import type { UnmeasuredEntry } from './design-types.js';

/** Status returned by `design-observe` comparing post-release journal metrics against baseline. */
export type DesignObserveStatus = 'improved' | 'unchanged' | 'regressed' | 'insufficient-data';

/** Request for `design-observe`. */
export interface DesignObserveRequest {
	/** Approved and released decision id (`dec-<12>`). */
	decision: string;
	/** Workspace-relative or workspace-contained path to a post-release AFD command journal (JSONL or JSON array). */
	journal: string;
	/** Optional pre-release AFD command journal path for before/after metric comparison. */
	beforeJournal?: string;
}

/** Aggregated command-journal metrics across observed runs. */
export interface DesignObserveMetricsSummary {
	runs: number;
	completionRate: number;
	unexpectedFailures: number;
	repeats: number;
	outsideSteps: number;
}

/** Post-release metrics with optional pre-release baseline snapshot. */
export interface DesignObserveMetrics extends DesignObserveMetricsSummary {
	before?: DesignObserveMetricsSummary;
}

/** Result returned by `design-observe`. */
export interface DesignObserveResult {
	decision: string;
	releasedAt: string;
	meantToFix?: {
		job: string;
		target: string;
	};
	status: DesignObserveStatus;
	metrics: DesignObserveMetrics;
	note: string;
	unmeasured: UnmeasuredEntry[];
}

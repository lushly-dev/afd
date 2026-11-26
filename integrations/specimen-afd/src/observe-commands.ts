/** AFD command definition for `design-observe` (Agent-First Design Phase D1). */

import type { CommandResult } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server/define';
import { designObserveRequestSchema, designObserveResultSchema } from '@lushly-dev/specimen/schema';
import type { DesignObserveRequest, DesignObserveResult } from '@lushly-dev/specimen/types';
import type { z } from 'zod';

export interface DesignObserveBench {
	designObserve(request: DesignObserveRequest): Promise<DesignObserveResult>;
}

type ResultRunner = <T>(
	operation: () => T | Promise<T>,
	output: z.ZodType<T>,
	code: string,
	suggestion: string
) => Promise<CommandResult<T>>;

export function createDesignObserveCommand(bench: DesignObserveBench, runResult: ResultRunner) {
	return defineCommand({
		category: 'design',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'design-observe',
		description:
			'Read a post-release AFD command journal (by workspace file path) against what an approved, released decision was meant to fix (meantToFix and releasedAt from specimens/releases/), optionally comparing against beforeJournal. Returns status: insufficient-data with metrics.runs: 0 when zero entries postdate releasedAt; always notes that movement is observation rather than proof of causation and lists perception-only-trouble in unmeasured. Read-only and browserless.',
		mutation: false,
		outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		errors: ['DECISION_NOT_FOUND', 'NOT_RELEASED', 'JOURNAL_NOT_FOUND'],
		input: designObserveRequestSchema,
		output: designObserveResultSchema,
		handler: async (input) =>
			runResult(
				() => bench.designObserve(input),
				designObserveResultSchema,
				'DESIGN_OBSERVE_FAILED',
				'Pass a released decision id (from decision-list) and readable workspace journal path(s).'
			),
	});
}

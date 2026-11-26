/** AFD command definitions for copied-pattern commands (`specimen-pattern-fork`, `specimen-pattern-compare`, `specimen-pattern-merge`). */
import type { CommandResult } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server/define';
import {
	patternCompareRequestSchema,
	patternCompareResultSchema,
	patternForkRequestSchema,
	patternForkResultSchema,
	patternMergeRequestSchema,
	patternMergeResultSchema,
} from '@lushly-dev/specimen/schema';
import type {
	PatternCompareRequest,
	PatternCompareResult,
	PatternForkRequest,
	PatternForkResult,
	PatternMergeRequest,
	PatternMergeResult,
} from '@lushly-dev/specimen/types';
import type { z } from 'zod';

export interface PatternForkBench {
	patternFork(request: PatternForkRequest): Promise<PatternForkResult>;
	patternCompare(request?: PatternCompareRequest): Promise<PatternCompareResult>;
	patternMerge(request: PatternMergeRequest): Promise<PatternMergeResult>;
}

type ResultRunner = <T>(
	operation: () => T | Promise<T>,
	output: z.ZodType<T>,
	code: string,
	suggestion: string
) => Promise<CommandResult<T>>;

export function createPatternForkCommands(bench: PatternForkBench, runResult: ResultRunner) {
	const patternFork = defineCommand({
		category: 'specimen',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'specimen-pattern-fork',
		description:
			'Copy an upstream pattern into specimens/patterns/<target>/pattern.json with derivedFrom statement digests, mark it proposed, and open a guidance decision card for person approval. Refuses overwriting existing targets with ALREADY_EXISTS.',
		mutation: true,
		outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		input: patternForkRequestSchema,
		output: patternForkResultSchema,
		handler: async (input) =>
			runResult(
				() => bench.patternFork(input),
				patternForkResultSchema,
				'SPECIMEN_PATTERN_FORK_FAILED',
				'Check the upstream <library>/<pattern> id or choose a new target id.'
			),
	});

	const patternCompare = defineCommand({
		category: 'specimen',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'specimen-pattern-compare',
		description:
			'Compare one copied pattern (or all copied patterns in bulk summary mode when pattern is omitted) statement-by-statement against its upstream derivedFrom source, classifying unchanged, changed-here, changed-upstream, changed-both, dropped-here, added-upstream, and declined.',
		mutation: false,
		outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
		input: patternCompareRequestSchema,
		output: patternCompareResultSchema,
		handler: async (input) =>
			runResult(
				() => bench.patternCompare(input),
				patternCompareResultSchema,
				'SPECIMEN_PATTERN_COMPARE_FAILED',
				'Pass a copied pattern created by specimen-pattern-fork or omit pattern for a bulk summary.'
			),
	});

	const patternMerge = defineCommand({
		category: 'specimen',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'specimen-pattern-merge',
		description:
			'Stage selected upstream statement updates and declines onto a guidance decision card pinned to upstreamVersion and upstream statement digests. Keeps the live pattern.json undisturbed until a person approves the card via decision-record.',
		mutation: true,
		outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		input: patternMergeRequestSchema,
		output: patternMergeResultSchema,
		handler: async (input) =>
			runResult(
				() => bench.patternMerge(input),
				patternMergeResultSchema,
				'SPECIMEN_PATTERN_MERGE_FAILED',
				'Run specimen-pattern-compare first and supply resolutions for changed-both statements and waivers for declined keep statements.'
			),
	});

	return [patternFork, patternCompare, patternMerge] as const;
}

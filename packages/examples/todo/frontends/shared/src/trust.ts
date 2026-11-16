/**
 * @fileoverview What a result says about itself, for the trust panel: how sure the command was,
 * why it did what it did, what it warns about, what it relied on and what else it could do.
 */

import type { CommandResult } from '@lushly-dev/afd-core';

export interface TrustSummary {
	command: string;
	success: boolean;
	/** 0 to 100, when the result gives a confidence */
	confidencePercent?: number;
	reasoning?: string;
	warnings: { code: string; message: string; severity: string }[];
	sources: { title: string; href?: string }[];
	alternatives: { reason: string }[];
	undo?: { command: string; args: Record<string, unknown> };
	error?: { code: string; message: string; suggestion?: string };
	durationMs?: number;
}

export function trustOf(
	command: string,
	result: CommandResult<unknown>,
	durationMs?: number
): TrustSummary {
	const sources = (result.sources ?? []) as { title?: string; url?: string; id?: string }[];
	return {
		command,
		success: result.success,
		...(typeof result.confidence === 'number' && {
			confidencePercent: Math.round(result.confidence * 100),
		}),
		...(result.reasoning && { reasoning: result.reasoning }),
		warnings: (result.warnings ?? []).map((warning) => ({
			code: warning.code,
			message: warning.message,
			severity: warning.severity ?? 'info',
		})),
		sources: sources.map((source) => ({
			title: source.title ?? source.id ?? source.url ?? 'Source',
			...(source.url && { href: source.url }),
		})),
		alternatives: ((result.alternatives ?? []) as { reason?: string }[]).map((alternative) => ({
			reason: alternative.reason ?? '',
		})),
		...(result.undoCommand && {
			undo: { command: result.undoCommand, args: { ...(result.undoArgs ?? {}) } },
		}),
		...(result.error && {
			error: {
				code: result.error.code,
				message: result.error.message,
				...(result.error.suggestion && { suggestion: result.error.suggestion }),
			},
		}),
		...(durationMs !== undefined && { durationMs }),
	};
}

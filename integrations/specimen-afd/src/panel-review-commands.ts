/** AFD command definitions for `panel-review` and `panel-calibrate` (Agent-First Design Phase C3). */
import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import { defineCommand } from '@lushly-dev/afd-server/define';
import {
	panelCalibrateRequestSchema,
	panelCalibrateResultSchema,
	panelReviewRequestSchema,
	panelReviewResultSchema,
} from '@lushly-dev/specimen/schema';
import type {
	PanelCalibrateRequest,
	PanelCalibrateResult,
	PanelReviewRequest,
	PanelReviewResult,
	RunPanelCalibrateOptions,
	RunPanelReviewOptions,
} from '@lushly-dev/specimen/types';
import type { z } from 'zod';
import {
	normalizeOptionalId,
	readSpecimenChangeAuthor,
	readSpecimenRelayConfirmation,
} from './relay.js';

export interface PanelReviewBench {
	panelReview(
		request: PanelReviewRequest,
		options?: RunPanelReviewOptions
	): Promise<PanelReviewResult>;
	panelCalibrate(
		request: PanelCalibrateRequest,
		options?: RunPanelCalibrateOptions
	): Promise<PanelCalibrateResult>;
}

type ResultRunner = <T>(
	operation: () => T | Promise<T>,
	output: z.ZodType<T>,
	code: string,
	suggestion: string
) => Promise<CommandResult<T>>;

export type DirectProvisionalRecorder = (
	input: {
		items: string[];
		chosen: 'accept' | 'reject';
		reason: string;
		reviewers: string[];
		split: string;
		changeAuthor: string;
	},
	context: CommandContext
) => Promise<{ decision?: string } | undefined>;

export function createPanelReviewCommands(
	bench: PanelReviewBench,
	runResult: ResultRunner,
	recordProvisionalDirect?: DirectProvisionalRecorder
) {
	const panelReview = defineCommand({
		category: 'panel',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'panel-review',
		description:
			'Orchestrate a multi-persona panel review across one or more jobs for a proposed change, measuring cross-family overlap, settling agreed non-trigger items provisionally, and emitting decision cards with evidenceForBothSides only for items that hit an escalation trigger. Also supports action: "withdraw" to withdraw open/provisional cards and items from a misconfigured run while preserving person-decided cards. Deliberately declares no approval gate so task execution remains supported.',
		mutation: true,
		executionTime: 'long-running',
		task: 'optional',
		outputBudget: { defaultBytes: 32768, maxBytes: 98304 },
		errors: ['AUTHOR_CANNOT_REVIEW', 'BUDGET_EXCEEDED', 'JOB_NOT_FOUND', 'RUN_NOT_FOUND'],
		input: panelReviewRequestSchema,
		output: panelReviewResultSchema,
		handler: async (input, context: CommandContext) => {
			const actorId = normalizeOptionalId(context.actor?.id);
			const changeAuthor = readSpecimenChangeAuthor(context);
			return runResult(
				() =>
					bench.panelReview(input, {
						...(actorId ? { actorId } : {}),
						...(changeAuthor ? { changeAuthor } : {}),
						...(recordProvisionalDirect
							? {
									recordProvisional: (provInput) => recordProvisionalDirect(provInput, context),
								}
							: {}),
					}),
				panelReviewResultSchema,
				'PANEL_REVIEW_FAILED',
				'Verify reviewer independence, job ids, target URL, and budget, or check the run id when withdrawing.'
			);
		},
	});

	const panelCalibrate = defineCommand({
		category: 'panel',
		expose: { mcp: true, cli: true },
		version: '0.1.0',
		name: 'panel-calibrate',
		description:
			'Sample provisional panel agreements blindly (action: "sample", omitting panelVerdict) and record independent person verdicts (action: "record") to compute server-side disagreement rates and reopen disagreed items as open decision cards. Do not call this to approve release, guidance, escalated cards, or calibration judgements as an agent; show the card or page URL to the person and wait.',
		mutation: true,
		confirmationMode: 'host-verified',
		confirmPrompt:
			'Confirm blind panel calibration session (sampling provisional agreements or recording independent person verdicts).',
		outputBudget: { defaultBytes: 16384, maxBytes: 49152 },
		errors: ['NOTHING_TO_SAMPLE', 'SAMPLE_NOT_FOUND', 'PERSON_REQUIRED'],
		input: panelCalibrateRequestSchema,
		output: panelCalibrateResultSchema,
		handler: async (input, context: CommandContext) => {
			const relay = readSpecimenRelayConfirmation(context, 'panel-calibrate');
			const actorId = normalizeOptionalId(relay?.confirmedBy ?? context.actor?.id);
			const actorKind = context.actor?.kind;
			// Never trust unverified `actor.kind === 'human'` as person authority; only host-minted
			// `HumanRelay` confirmation (or explicit test actor) authorizes `action: 'record'`.
			const invokingActorKind: RunPanelCalibrateOptions['invokingActorKind'] =
				relay !== undefined
					? 'person'
					: actorKind === 'agent'
						? 'agent'
						: actorKind === 'test'
							? 'test'
							: 'script';
			return runResult(
				() =>
					bench.panelCalibrate(input, {
						...(relay !== undefined ? { humanConfirmed: true } : {}),
						invokingActorKind,
						...(actorId ? { actorId } : {}),
					}),
				panelCalibrateResultSchema,
				'PANEL_CALIBRATE_FAILED',
				'Run panel-review first to populate provisional agreements, or pass a valid sample id with host-verified person confirmation.'
			);
		},
	});

	return [panelReview, panelCalibrate] as const;
}

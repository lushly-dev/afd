/**
 * @fileoverview One up-front approval for an `afd-batch` or `afd-pipe` (#459, option A).
 *
 * Asking mid-run would run the earlier steps again on the retry, so the approval middleware
 * decides the whole call before any step's handler runs, the first time a step reaches it:
 *
 * - a gated pipeline step whose input comes from an earlier step (`$prev`, `$first`, `$steps`)
 *   cannot be shown to the human up front, so nothing runs and the agent is told to split the
 *   pipeline there;
 * - otherwise, when the request carries the human's acceptance of every gated step (each bound to
 *   its command, canonical validated input and actor, with a MAC, an expiry and a nonce), each
 *   nonce is spent and the call runs: each gated step then takes one approval matching its own
 *   binding, once;
 * - a decline refuses the call; anything else asks once, listing every gated step.
 *
 * While the plan is not to run, every step answers without calling `next`, and the router answers
 * the call with the refusal (or the lane with the elicitation), so no handler runs.
 *
 * Only the MCP lane loads this module (through its relay's `upFront`): a host that runs commands
 * in process, with or without the approval middleware or the tool surface, never does.
 */

import type {
	BatchRequest,
	CommandContext,
	CommandError,
	CommandResult,
	PipelineRequest,
} from '@lushly-dev/afd-core';
import { ErrorCodes, failure } from '@lushly-dev/afd-core';
import { actorJson, canonicalJson } from './approval-crypto.js';
import {
	type AcceptedApproval,
	type ApprovalRelay,
	releaseUpFrontApproval,
	shownInput,
	type UpFrontApproval,
	type UpFrontDeps,
	type UpFrontStep,
} from './approval-relay.js';
import type { ZodCommandDefinition } from './schema.js';
import { batchSteps, pipelineSteps } from './up-front-steps.js';

/** An approval the human gave up front, taken once by the step it is bound to. */
interface Approved {
	binding: string;
	used: boolean;
}

type Plan = { kind: 'run'; approved: Approved[] } | { kind: 'refuse'; error: CommandError };

/** The most gated steps one question lists; a person cannot weigh more at once. */
export const MAX_UP_FRONT_APPROVALS = 20;

/**
 * The up-front approval of one `afd-batch` or `afd-pipe` request that can carry a form
 * elicitation, asking and reading answers through `relay`. Its steps are worked out only if an
 * approval middleware asks for them.
 */
export function createUpFrontApproval(
	relay: ApprovalRelay,
	tool: UpFrontApproval['tool'],
	request: BatchRequest | PipelineRequest,
	commands: readonly ZodCommandDefinition[]
): UpFrontApproval {
	let steps: UpFrontStep[] | undefined;
	const upFront: UpFrontApproval = {
		tool,
		relay,
		call: requestJson(tool, request),
		conditional: 'steps' in request && request.steps.some((step) => step.when !== undefined),
		steps: () => {
			steps ??=
				'steps' in request ? pipelineSteps(request, commands) : batchSteps(request, commands);
			return steps;
		},
		run: (deps, command, input, context, next) =>
			gateFor(deps)(upFront, command, input, context, next),
	};
	return upFront;
}

/** The request an up-front approval is bound to, as canonical JSON (the wire sends plain JSON). */
function requestJson(tool: string, request: BatchRequest | PipelineRequest): string {
	try {
		return canonicalJson([tool, request]);
	} catch {
		return JSON.stringify([tool, request]);
	}
}

type Gate = (
	upFront: UpFrontApproval,
	command: string,
	input: unknown,
	context: CommandContext,
	next: () => Promise<CommandResult>
) => Promise<CommandResult>;

/** One gate per approval middleware, so each keeps its own plans. */
const gates = new WeakMap<UpFrontDeps, Gate>();

function gateFor(deps: UpFrontDeps): Gate {
	let gate = gates.get(deps);
	if (!gate) {
		gate = createUpFrontGate(deps);
		gates.set(deps, gate);
	}
	return gate;
}

/** Create the gate an approval middleware runs each step of an up-front call through. */
function createUpFrontGate(deps: UpFrontDeps): Gate {
	// One plan per call, shared by its steps (concurrent ones too) and decided before any runs.
	const plans = new WeakMap<UpFrontApproval, Promise<Plan>>();
	const tags = new WeakMap<UpFrontApproval, Promise<string[]>>();

	/** Approvals are bound to the call, so one given for this request covers no other. */
	function callTags(upFront: UpFrontApproval): Promise<string[]> {
		let tagged = tags.get(upFront);
		if (!tagged) {
			tagged = deps.callTags(upFront.call);
			tags.set(upFront, tagged);
		}
		return tagged;
	}

	async function decide(upFront: UpFrontApproval, context: CommandContext): Promise<Plan> {
		const steps = upFront.steps();
		const late = steps.find((step) => step.dynamic && deps.mayRequireApproval(step.command));
		if (late) return { kind: 'refuse', error: splitError(upFront.tool, late.index, late.command) };
		const scope = await callTags(upFront);

		const now = deps.clock.now();
		const actor = actorJson(context.actor);
		const gated: Array<GatedStep & { bindings: string[] }> = [];
		for (const step of steps) {
			if (step.dynamic || !step.valid) continue;
			if (!(await deps.requiresApproval(step.command, step.input, context))) continue;
			const input = canonicalJson(step.input);
			gated.push({
				index: step.index,
				command: step.command,
				input,
				summary: deps.summarize(step.command, step.input, context),
				bindings: await deps.bindings(scope, step.command, input, actor),
			});
			if (gated.length > MAX_UP_FRONT_APPROVALS) {
				return { kind: 'refuse', error: tooManyError(upFront.tool) };
			}
		}
		if (gated.length === 0) return { kind: 'run', approved: [] };

		const answers = await upFront.relay.answers();
		const declined = gated.filter((step) =>
			step.bindings.some((binding) => answers.declined.includes(binding))
		);
		if (declined.length > 0) return { kind: 'refuse', error: declinedError(upFront.tool, gated) };

		// Each gated step takes a distinct genuine acceptance of its own binding, so two identical
		// steps need two. The latest answer wins: later answers are read last.
		const pool = [...answers.accepted];
		const matched: AcceptedApproval[] = [];
		for (const step of gated) {
			let found = -1;
			for (let at = pool.length - 1; at >= 0; at--) {
				const answer = pool[at] as AcceptedApproval;
				if (
					step.bindings.includes(answer.binding) &&
					(await deps.genuine(answer, step.bindings, now))
				) {
					found = at;
					break;
				}
			}
			if (found < 0) break;
			matched.push(...pool.splice(found, 1));
		}
		if (matched.length === gated.length) {
			// Spend every nonce before anything runs: a replay of this request runs nothing.
			let fresh = true;
			for (const answer of matched) {
				if (!(await deps.spend(answer.nonce, answer.expiresAt, now))) fresh = false;
			}
			if (fresh) {
				return {
					kind: 'run',
					approved: matched.map((answer) => ({ binding: answer.binding, used: false })),
				};
			}
		}

		// Ask once for every gated step, saying why when earlier approvals did not hold.
		const questions = await Promise.all(gated.map((step) => deps.question(step.bindings, now)));
		upFront.relay.holdSteps({
			questions,
			message: stepsRelayMessage(
				upFront,
				gated,
				answers.accepted.length > 0
					? 'The earlier approval expired, was already used or no longer matches; approve again to run it.'
					: undefined
			),
		});
		return { kind: 'refuse', error: pendingError(upFront.tool, gated) };
	}

	/**
	 * Run one step of an up-front call: nothing runs until the plan is to run, and then a gated
	 * step runs only on an unused approval of its own binding.
	 */
	return async function runStep(
		upFront: UpFrontApproval,
		commandName: string,
		input: unknown,
		context: CommandContext,
		next: () => Promise<CommandResult>
	): Promise<CommandResult> {
		let plan = plans.get(upFront);
		if (!plan) {
			plan = decide(upFront, context);
			plans.set(upFront, plan);
		}
		const decided = await plan;
		if (decided.kind === 'refuse') {
			upFront.refusal ??= decided.error;
			return failure(decided.error);
		}
		// The handler, and any command it runs, never sees the up-front approval.
		releaseUpFrontApproval(context);
		if (!(await deps.requiresApproval(commandName, input, context))) return next();
		const bindings = await deps.bindings(
			await callTags(upFront),
			commandName,
			canonicalJson(input),
			actorJson(context.actor)
		);
		// A step whose batch or pipeline already timed out or was cancelled never starts: its
		// caller was told it did not run.
		if (context.signal?.aborted) return failure(cancelledError(upFront.tool, commandName));
		// No await between finding and taking it, so concurrent steps cannot take the same one.
		// Its expiry was checked when the call started, as a single command's is.
		const approval = decided.approved.find((item) => !item.used && bindings.includes(item.binding));
		if (approval) {
			approval.used = true;
			return next();
		}
		return failure(unplannedError(upFront.tool, commandName));
	};
}

function toolName(tool: UpFrontApproval['tool']): string {
	return tool === 'afd-batch' ? 'batch' : 'pipeline';
}

/** A gated step whose input is not known until the pipeline runs: nothing ran. */
function splitError(tool: UpFrontApproval['tool'], index: number, command: string): CommandError {
	return {
		code: ErrorCodes.APPROVAL_REQUIRED,
		message: `${command} (the step at index ${index}) needs approval, and its input comes from an earlier step, so the user cannot approve it before the ${toolName(tool)} runs. Nothing ran.`,
		suggestion: `Split the ${toolName(tool)} before the step at index ${index}: run the steps before it with ${tool}, then call ${command} on its own with the input they returned, so the client can ask the user.`,
		retryable: false,
		details: { reason: 'input-not-known', step: index, command },
	};
}

function declinedError(tool: UpFrontApproval['tool'], gated: readonly GatedStep[]): CommandError {
	const names = [...new Set(gated.map((step) => step.command))].join(', ');
	return {
		code: ErrorCodes.APPROVAL_REQUIRED,
		message: `The user did not approve ${names}; nothing in the ${toolName(tool)} ran`,
		suggestion:
			'Do not run this again without asking the user first; the user chose not to approve it.',
		retryable: false,
		details: { reason: 'declined', summary: gated.map((step) => step.summary).join('; ') },
	};
}

/** More gated steps than one question may list: nothing ran. */
function tooManyError(tool: UpFrontApproval['tool']): CommandError {
	return {
		code: ErrorCodes.APPROVAL_REQUIRED,
		message: `The ${toolName(tool)} has more than ${MAX_UP_FRONT_APPROVALS} steps that need approval, more than the user can be asked about at once. Nothing ran.`,
		suggestion: `Split it into calls of ${tool} with at most ${MAX_UP_FRONT_APPROVALS} steps that need approval each.`,
		retryable: false,
		details: { reason: 'too-many-approvals', limit: MAX_UP_FRONT_APPROVALS },
	};
}

/** A step whose call already timed out or was cancelled. */
function cancelledError(tool: UpFrontApproval['tool'], command: string): CommandError {
	return {
		code: ErrorCodes.COMMAND_CANCELLED,
		message: `${command} did not run: the ${toolName(tool)} timed out or was cancelled first`,
		suggestion: `Check which steps ran before running the ${toolName(tool)} again; the user is asked again for a new approval.`,
		retryable: false,
	};
}

/** The result while the human is asked; the lane answers with the elicitation instead. */
function pendingError(tool: UpFrontApproval['tool'], gated: readonly GatedStep[]): CommandError {
	const summary = gated.map((step) => step.summary).join('; ');
	return {
		code: ErrorCodes.APPROVAL_REQUIRED,
		message: `The ${toolName(tool)} needs approval before it runs`,
		suggestion: `Wait for the user to approve "${summary}" in the client.`,
		retryable: false,
		details: { summary },
	};
}

/** A gated step the human was not asked about up front (its policy changed its mind). */
function unplannedError(tool: UpFrontApproval['tool'], command: string): CommandError {
	return {
		code: ErrorCodes.APPROVAL_REQUIRED,
		message: `${command} needs approval before it runs`,
		suggestion: `Ask the user to approve it; the client could not be asked for this step of the ${toolName(tool)}. Call ${command} on its own so the client can ask the user.`,
		retryable: false,
		details: { summary: `Run ${command}` },
	};
}

/** One gated step as the up-front question shows it. */
interface GatedStep {
	index: number;
	command: string;
	/** The canonical JSON of its validated input. */
	input: string;
	summary: string;
}

/**
 * The question of an up-front approval: what the call is, then each gated step's summary,
 * command and canonical input, so the human sees exactly what would run.
 */
function stepsRelayMessage(
	upFront: Pick<UpFrontApproval, 'tool' | 'conditional'>,
	steps: readonly GatedStep[],
	note?: string
): string {
	const what = upFront.tool === 'afd-batch' ? 'batch' : 'pipeline';
	const count = steps.length === 1 ? 'a step that needs' : `${steps.length} steps that need`;
	const lines = [
		...(note ? [note] : []),
		`This ${what} includes ${count} your approval. Approving lets each run once, exactly as shown; if you do not approve, nothing in the ${what} runs.`,
		...(upFront.conditional
			? [
					'Some steps run only when their conditions hold, so one step may run while another is skipped.',
				]
			: []),
	];
	for (const step of steps) {
		lines.push(
			'',
			`Step ${step.index + 1}: ${step.summary}`,
			`Command: ${step.command}`,
			`Input: ${shownInput(step.input)}`
		);
	}
	return lines.join('\n');
}

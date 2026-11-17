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
 */

import type { Clock, CommandContext, CommandError, CommandResult } from '@lushly-dev/afd-core';
import { ErrorCodes, failure } from '@lushly-dev/afd-core';
import { actorJson, canonicalJson } from './approval-crypto.js';
import {
	type AcceptedApproval,
	type ApprovalQuestion,
	type GatedStep,
	stepsRelayMessage,
	type UpFrontApproval,
} from './approval-relay.js';

/** What the up-front gate needs from the approval middleware. */
export interface UpFrontDeps {
	clock: Clock;
	/** Whether `command`'s policy holds this input. */
	requiresApproval(command: string, input: unknown, context: CommandContext): Promise<boolean>;
	/** Whether `command`'s policy could hold some input ('required' or a function). */
	mayRequireApproval(command: string): boolean;
	/** The relay bindings of a command, input and actor, one per key, the signing key's first. */
	bindings(command: string, input: string, actor: string): Promise<string[]>;
	/** Whether an accepted approval's MAC verifies for `bindings` and it has not expired. */
	genuine(answer: AcceptedApproval, bindings: readonly string[], now: number): Promise<boolean>;
	/** Spend a single-use nonce; `true` when it was fresh (or reuse is allowed). */
	spend(nonce: string, expiresAt: number, now: number): Promise<boolean>;
	/** A fresh question (nonce, expiry and MAC) for `bindings`. */
	question(bindings: readonly string[], now: number): Promise<ApprovalQuestion>;
	summarize(command: string, input: unknown, context: CommandContext): string;
}

/** An approval the human gave up front, taken once by the step it is bound to. */
interface Approved {
	binding: string;
	used: boolean;
}

type Plan = { kind: 'run'; approved: Approved[] } | { kind: 'refuse'; error: CommandError };

/** Create the gate the approval middleware runs each step of an up-front call through. */
export function createUpFrontGate(deps: UpFrontDeps) {
	// One plan per call, shared by its steps (concurrent ones too) and decided before any runs.
	const plans = new WeakMap<UpFrontApproval, Promise<Plan>>();

	async function decide(upFront: UpFrontApproval, context: CommandContext): Promise<Plan> {
		const steps = upFront.steps();
		const late = steps.find((step) => step.dynamic && deps.mayRequireApproval(step.command));
		if (late) return { kind: 'refuse', error: splitError(upFront.tool, late.index, late.command) };

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
				bindings: await deps.bindings(step.command, input, actor),
			});
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
				upFront.tool,
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
		if (!(await deps.requiresApproval(commandName, input, context))) return next();
		const bindings = await deps.bindings(
			commandName,
			canonicalJson(input),
			actorJson(context.actor)
		);
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
		message: `${command} (step ${index}) needs approval, and its input comes from an earlier step, so the user cannot approve it before the ${toolName(tool)} runs. Nothing ran.`,
		suggestion: `Split the ${toolName(tool)} at step ${index}: run the steps before it with ${tool}, then call ${command} on its own with the input they returned, so the client can ask the user.`,
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

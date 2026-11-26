/**
 * @fileoverview The MCP approval relay (#418): how the approval middleware asks the human behind
 * an MCP client, through a form elicitation, instead of returning a token to the agent.
 *
 * The MCP lane binds an {@link ApprovalRelay} to the context of each `tools/call` that can carry a
 * form elicitation, in its host state (`host-state.ts`, as the confirmation channel is), so neither
 * `createContext` nor tool arguments can forge one. The tool router names the one command the
 * call routes to; with `relay: 'mcp-elicitation'`, the approval middleware of that command reads
 * the human's answer from the relay or records a hold on it, and the lane then answers the call
 * with `input_required` instead of the held result.
 *
 * `afd-batch` and `afd-pipe` replace the relay with one that never asks, because asking mid-run
 * would run the earlier steps again on the retry. Instead (#459), the router binds an
 * {@link UpFrontApproval} for the whole call: before any step runs, the approval middleware works
 * out every gated step's input and asks once for all of them, or refuses the call when a gated
 * pipeline step's input comes from an earlier step.
 */

import type {
	BatchRequest,
	Clock,
	CommandContext,
	CommandError,
	CommandResult,
	PipelineRequest,
} from '@lushly-dev/afd-core';
import { hostState, patchHostStateInPlace, withHostState } from './host-state.js';
import type { ZodCommandDefinition } from './schema.js';

/** The `inputRequests` key of the approval elicitation. */
export const APPROVAL_INPUT_KEY = 'approval';

/** The approval elicitation form: one required boolean. */
export const APPROVAL_REQUESTED_SCHEMA = {
	type: 'object',
	properties: {
		approve: {
			type: 'boolean',
			title: 'Approve',
			description: 'Allow this action to run',
		},
	},
	required: ['approve'],
} as const;

/**
 * The step of an `afd-batch` or `afd-pipe` an up-front approval was asked for, kept with the
 * question in the signed `requestState` (#1414). The request that brings the answer runs the step
 * on this input instead of validating what was sent again, so a schema whose defaults differ from
 * one validation to the next (a random id, the time) still runs exactly what the human approved.
 */
export interface ApprovedStep {
	/** The step's position in the request, 0-based. */
	index: number;
	/** The canonical JSON of the step's validated input, as the human was shown it. */
	input: string;
	/** A digest of the whole request as sent: the input serves that request and no other. */
	call: string;
}

/** One approval asked of the human: a command, its validated input and the actor. */
export interface ApprovalQuestion {
	/** Keyed digest of the command, its validated input and the actor, under the signing key. */
	binding: string;
	/** The same digest under every verification key: earlier answers to any of them are dropped. */
	bindings: readonly string[];
	/** Random nonce, spent when the approved call runs. */
	nonce: string;
	/** Expiry of the approval, epoch milliseconds on the middleware's clock. */
	expiresAt: number;
	/** MAC of the binding, nonce and expiry under the approval secret. */
	mac: string;
	/** For an up-front approval, the step asked about (left out when its input is too long to keep). */
	step?: ApprovedStep;
}

/** A call held for the human's approval, as recorded by the middleware. */
export interface ApprovalHold extends ApprovalQuestion {
	/** The question shown to the human. */
	message: string;
}

/**
 * A whole `afd-batch` or `afd-pipe` held for the human's approval: one elicitation, one
 * question per gated step, each answered by the same form.
 */
export interface StepsHold {
	questions: readonly ApprovalQuestion[];
	/** The question shown to the human, listing every gated step. */
	message: string;
}

/** An accepted approval as the request carries it: its binding, nonce, expiry and MAC. */
export interface AcceptedApproval {
	binding: string;
	nonce: string;
	expiresAt: number;
	mac: string;
	/** The step the approval was asked for, when the question kept it. */
	step?: ApprovedStep;
}

/** The human's answer to an earlier approval elicitation for one binding. */
export type ApprovalAnswer =
	| ({ kind: 'accept' } & AcceptedApproval)
	| { kind: 'decline' }
	| { kind: 'missing' };

/** Every approval answer a request carries: those accepted, and the bindings declined. */
export interface ApprovalAnswers {
	accepted: readonly AcceptedApproval[];
	declined: readonly string[];
}

/** What one MCP `tools/call` offers the approval middleware. */
export interface ApprovalRelay {
	/** Name the command this tool call routes to; only that command can claim the relay. */
	route(command: string): void;
	/**
	 * Take the relay for `command`. Only the routed command, and only once, so a command run by
	 * another command's handler (or a later step) cannot turn the tool call into an elicitation.
	 */
	claim(command: string): boolean;
	/**
	 * The answer this request carries for any of `bindings` (one per verification key): `missing`
	 * unless its `requestState` verifies and names that binding. The latest answer wins.
	 */
	answer(bindings: readonly string[]): Promise<ApprovalAnswer>;
	/** Record that the call needs the human's approval; the lane asks once the call returns. */
	hold(hold: ApprovalHold): void;
	/** Every approval answer this request carries, for an up-front approval of several steps. */
	answers(): Promise<ApprovalAnswers>;
	/** Record that a batch or pipeline needs the human's approval of `hold`'s steps. */
	holdSteps(hold: StepsHold): void;
	/**
	 * The up-front approval of an `afd-batch` or `afd-pipe` request, which runs `commands` (#459).
	 * Only the MCP lane offers one, so a host that never serves MCP does not load its code.
	 */
	upFront?(
		tool: UpFrontApproval['tool'],
		request: BatchRequest | PipelineRequest,
		commands: readonly ZodCommandDefinition[]
	): UpFrontApproval;
}

/** What the up-front gate needs from the approval middleware. */
export interface UpFrontDeps {
	clock: Clock;
	/** Whether `command`'s policy holds this input. */
	requiresApproval(command: string, input: unknown, context: CommandContext): Promise<boolean>;
	/** Whether `command`'s policy could hold some input ('required' or a function). */
	mayRequireApproval(command: string, context: CommandContext): boolean;
	/**
	 * The bindings of an up-front approval, one per key, the signing key's first: a keyed digest of
	 * the call (its {@link callTags} under that key), the command, its input and the actor.
	 */
	bindings(
		tags: readonly string[],
		command: string,
		input: string,
		actor: string
	): Promise<string[]>;
	/** The call's tag under each key: a keyed digest of the whole request as sent. */
	callTags(call: string): Promise<string[]>;
	/** Whether an accepted approval's MAC verifies for `bindings` and it has not expired. */
	genuine(answer: AcceptedApproval, bindings: readonly string[], now: number): Promise<boolean>;
	/** Spend a single-use nonce; `true` when it was fresh (or reuse is allowed). */
	spend(nonce: string, expiresAt: number, now: number): Promise<boolean>;
	/** A fresh question (nonce, expiry and MAC) for `bindings`. */
	question(bindings: readonly string[], now: number): Promise<ApprovalQuestion>;
	summarize(command: string, input: unknown, context: CommandContext): string;
}

/** One step of an `afd-batch` or `afd-pipe`, as the up-front approval sees it. */
export interface UpFrontStep {
	/** The step's position in the request, 0-based as in its results. */
	index: number;
	command: string;
	/**
	 * Whether the step's input comes from an earlier step (`$prev`, `$first` or `$steps`), so its
	 * input is not known until the pipeline runs.
	 */
	dynamic: boolean;
	/** The validated input of a step that is not dynamic; absent when it does not validate. */
	input?: unknown;
	/** Whether {@link input} holds the validated input. */
	valid: boolean;
	/**
	 * The input as sent (after `$input` references are resolved), as canonical JSON: how the engine
	 * finds the step it is about to run. Absent when {@link valid} is false.
	 */
	sent?: string;
}

/**
 * The up-front approval of one `afd-batch` or `afd-pipe` call that can carry a form elicitation
 * (#459). The approval middleware decides it once, before any step's handler runs: every step
 * runs, each gated step on its own single-use approval, or none does.
 */
export interface UpFrontApproval {
	tool: 'afd-batch' | 'afd-pipe';
	/**
	 * The whole request as sent (its steps or commands, inputs, conditions and options), as
	 * canonical JSON: every approval is bound to it, so it covers this call and no other.
	 */
	call: string;
	/** Whether a step runs only under a condition (`when`), so one may run while another is skipped. */
	conditional: boolean;
	/**
	 * The call's steps, worked out once, when the engine or the middleware first asks for them. A
	 * step the human already approved in an earlier round of this request has the input approved
	 * then; any other is validated now.
	 */
	steps(): Promise<readonly UpFrontStep[]>;
	/**
	 * The input validated up front for a step that runs `command` on `input` as sent, handed out
	 * once per step (#1414). The server runs the step on it instead of on a second validation's
	 * result, so the input that runs is the one the human approved even when the schema's defaults
	 * differ from one validation to the next (a random id, the time). `undefined` for a command
	 * with no approval policy and for a step that is not known up front or did not validate: the
	 * step runs on its own validation, as usual.
	 */
	validated(command: string, input: unknown): Promise<{ input: unknown } | undefined>;
	/**
	 * The server's definition of `command` (its approval policy and prompt), so the middleware
	 * decides every step from the command that step runs.
	 */
	command(
		command: string
	): Pick<ZodCommandDefinition, 'name' | 'approval' | 'confirmPrompt'> | undefined;
	/**
	 * Run one step through the up-front gate, with the approval middleware's own keys, nonce
	 * store and policies (`deps`): nothing runs until the whole call is approved.
	 */
	run(
		deps: UpFrontDeps,
		command: string,
		input: unknown,
		context: CommandContext,
		/** Lets the step through, admitting it on the canonical input it was decided on. */
		next: (canonical: string | undefined) => Promise<CommandResult>
	): Promise<CommandResult>;
	/** The call's relay, which reads the human's answers and records the hold. */
	relay: ApprovalRelay;
	/**
	 * Set by the middleware when nothing may run (a gated step whose input is not known up front,
	 * a decline, or a pending question): the router answers with this instead of the run.
	 */
	refusal?: CommandError;
}

/** A relay that never asks: the steps of `afd-batch` and `afd-pipe` get it. */
const NEVER_ASKS: ApprovalRelay = {
	route() {},
	claim: () => false,
	answer: async () => ({ kind: 'missing' }),
	hold() {},
	answers: async () => ({ accepted: [], declined: [] }),
	holdSteps() {},
};

/** Return a copy of `context` bound to `relay`. */
export function bindApprovalRelay(context: CommandContext, relay: ApprovalRelay): CommandContext {
	return withHostState(context, { approvalRelay: relay });
}

/**
 * Return a copy of `context` whose relay never asks (for `afd-batch` and `afd-pipe` steps), so the
 * middleware can still tell the agent to run the command on its own.
 */
export function withoutApprovalRelay(context: CommandContext): CommandContext {
	if (!hostState(context).approvalRelay) return context;
	return bindApprovalRelay(context, NEVER_ASKS);
}

/** The relay bound to `context`, if any. */
export function approvalRelay(context: CommandContext | undefined): ApprovalRelay | undefined {
	return hostState(context).approvalRelay;
}

/**
 * Return a copy of `context` for the steps of an `afd-batch` or `afd-pipe` whose call can carry a
 * form elicitation: its relay never asks for one step, and `upFront` asks once for them all.
 */
export function bindUpFrontApproval(
	context: CommandContext,
	upFront: UpFrontApproval
): CommandContext {
	return withHostState(context, { approvalRelay: NEVER_ASKS, upFrontApproval: upFront });
}

/** The up-front approval bound to `context`, if any. */
export function upFrontApproval(context: CommandContext | undefined): UpFrontApproval | undefined {
	return hostState(context).upFrontApproval;
}

/**
 * Remove the up-front approval from a step's own context before its handler runs, so a command
 * the handler runs never takes a step's approval. Each step runs with a context of its own. The
 * approval middleware does this (not the engine, which keeps the gate out of `/direct` hosts), so
 * only a handler behind an `mcp-elicitation` approval middleware is covered. The approval is read
 * twice: by that middleware, and by the engine's up-front step hook, which takes the step's
 * approved input (#1414). Without the middleware nothing is gated, so a nested command could at
 * most take a later step's approved input as its own, never an approval. A retry middleware placed
 * before it retries the step on the ordinary single-command path, which holds it again.
 */
export function releaseUpFrontApproval(context: CommandContext): void {
	patchHostStateInPlace(context, { upFrontApproval: undefined });
}

/** Longest input shown in an approval elicitation, in characters. */
const MAX_SHOWN_INPUT = 1000;

export function shownInput(input: string): string {
	return input.length > MAX_SHOWN_INPUT ? `${input.slice(0, MAX_SHOWN_INPUT)}…` : input;
}

/** The question of a relayed approval: the summary, then what exactly would run. */
export function relayMessage(
	summary: string,
	command: string,
	input: string,
	note?: string
): string {
	return [
		...(note ? [note] : []),
		summary,
		'',
		`Command: ${command}`,
		`Input: ${shownInput(input)}`,
	].join('\n');
}

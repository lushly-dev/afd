/**
 * @fileoverview The MCP approval relay (#418): how the approval middleware asks the human behind
 * an MCP client, through a form elicitation, instead of returning a token to the agent.
 *
 * The MCP lane binds an {@link ApprovalRelay} to the context of each `tools/call` that can carry a
 * form elicitation, under a private symbol (as the confirmation channel is), so neither
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

import type { CommandContext, CommandError } from '@lushly-dev/afd-core';

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
}

/**
 * The up-front approval of one `afd-batch` or `afd-pipe` call that can carry a form elicitation
 * (#459). The approval middleware decides it once, before any step's handler runs: every step
 * runs, each gated step on its own single-use approval, or none does.
 */
export interface UpFrontApproval {
	tool: 'afd-batch' | 'afd-pipe';
	/** The call's steps, worked out when the middleware first asks for them. */
	steps(): readonly UpFrontStep[];
	/** The call's relay, which reads the human's answers and records the hold. */
	relay: ApprovalRelay;
	/**
	 * Set by the middleware when nothing may run (a gated step whose input is not known up front,
	 * a decline, or a pending question): the router answers with this instead of the run.
	 */
	refusal?: CommandError;
}

const RELAY = Symbol('afd.approvalRelay');
const UP_FRONT = Symbol('afd.upFrontApproval');

type RelayContext = CommandContext & {
	[RELAY]?: ApprovalRelay;
	[UP_FRONT]?: UpFrontApproval;
};

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
	const bound: RelayContext = { ...context, [RELAY]: relay };
	return bound;
}

/**
 * Return a copy of `context` whose relay never asks (for `afd-batch` and `afd-pipe` steps), so the
 * middleware can still tell the agent to run the command on its own.
 */
export function withoutApprovalRelay(context: CommandContext): CommandContext {
	if (!(context as RelayContext)[RELAY]) return context;
	return bindApprovalRelay(context, NEVER_ASKS);
}

/** The relay bound to `context`, if any. */
export function approvalRelay(context: CommandContext | undefined): ApprovalRelay | undefined {
	return (context as RelayContext | undefined)?.[RELAY];
}

/**
 * Return a copy of `context` for the steps of an `afd-batch` or `afd-pipe` whose call can carry a
 * form elicitation: its relay never asks for one step, and `upFront` asks once for them all.
 */
export function bindUpFrontApproval(
	context: CommandContext,
	upFront: UpFrontApproval
): CommandContext {
	const bound: RelayContext = { ...context, [RELAY]: NEVER_ASKS, [UP_FRONT]: upFront };
	return bound;
}

/** The up-front approval bound to `context`, if any. */
export function upFrontApproval(context: CommandContext | undefined): UpFrontApproval | undefined {
	return (context as RelayContext | undefined)?.[UP_FRONT];
}

/** Longest input shown in an approval elicitation, in characters. */
const MAX_SHOWN_INPUT = 1000;

function shownInput(input: string): string {
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

/** One gated step as the up-front question shows it. */
export interface GatedStep {
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
export function stepsRelayMessage(
	tool: UpFrontApproval['tool'],
	steps: readonly GatedStep[],
	note?: string
): string {
	const what = tool === 'afd-batch' ? 'This batch' : 'This pipeline';
	const count = steps.length === 1 ? 'a step that needs' : `${steps.length} steps that need`;
	const lines = [
		...(note ? [note] : []),
		`${what} runs ${count} your approval. Nothing runs unless you approve all of them.`,
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

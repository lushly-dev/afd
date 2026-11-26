/**
 * @fileoverview The copilot's records, its seam with the host, and the ports' messages (phase 5 specification,
 * 3.2 to 3.5, 4.3). Types only, so `late/` and first paint import nothing of the `late-copilot` chunk.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type {
	ConfirmationAskedV1,
	ConfirmationPreviewV1,
	ResourceLinkV1,
} from '@lushly-dev/loam-sdk';
import type { ScopeV1 } from '../scope/records.js';
import type { SuggestionV1 } from './enforce.js';

/**
 * The trace every copilot call carries, set by the kernel alone (3.2): the session, the turn's `seq` and the
 * agent port's call id. The kernel accepts it only from the options object it gives the agent port's half,
 * never from a caller's options, and copies it to every call made while that call runs, nested calls included.
 */
export interface CopilotTraceV1 {
	session: string;
	turn: number;
	call: string;
}

/** A provider kind (4.1). `test` is the scripted provider, the only kind a static deployment may name. */
export type CopilotProviderKindV1 = 'anthropic' | 'openai' | 'openai-compatible' | 'test';

/** A provider as `copilot-provider-list` gives it: never a key or an endpoint (4.1, D63). */
export interface CopilotProviderV1 {
	id: string;
	kind: CopilotProviderKindV1;
	model: string;
}

/** 3.4's session record. */
export interface CopilotSessionV1 {
	/** `cps_` and 16 hex digits. */
	id: string;
	scope: { project?: string };
	/** The person's key. */
	person: string;
	/** A provider id from the deployment, or `''` when none was configured when it started (4.1). */
	provider: string;
	/** 1 to 80 characters, the person's or "Untitled". */
	title: string;
	/** Instances or apps whose content entered (5.3), each once, with when it first did. */
	taint: Array<{ source: string; at: number }>;
	createdAt: number;
	endedAt?: number;
}

export type CopilotTurnStateV1 = 'running' | 'waiting' | 'done' | 'stopped' | 'failed';

/** One call a turn made, as 3.4 records it. */
export interface CopilotCallV1 {
	callId: string;
	command: string;
	instance?: string;
	/** `sha256:` and the hex SHA-256 of the input's canonical JSON. */
	inputDigest: string;
	mode: 'act' | 'ask' | 'suggest';
	reason?: 'policy' | 'taint' | 'unit';
	outcome: 'ok' | 'error' | 'pending' | 'suggested';
	code?: string;
	notification?: string;
	suggestion?: string;
	undo?: string;
	labels: { content: number; server: number; trusted: number };
	unit?: { id: string; state: 'composed' | 'failed' };
}

/** 3.4's turn record. */
export interface CopilotTurnV1 {
	session: string;
	/** From 1. */
	seq: number;
	/** The person's message, 1 to 32,768 characters. */
	text: string;
	attach: ReadonlyArray<ResourceLinkV1>;
	state: CopilotTurnStateV1;
	calls: CopilotCallV1[];
	/** The model's text, at most 65,536 characters. */
	reply: string;
	usage: { inputTokens: number; outputTokens: number };
	stoppedBy?: 'person' | 'limit' | 'session-changed';
	failure?: { code: string };
}

/** A tool as the copilot's model is given it (4.5). */
export interface ToolDescriptorV1 {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** A `per-part` instance's description: its server's claim, which the runtime blocks as one (5.2). */
	claim?: { source: string };
}

/** A message of the history 5.2's builder gets: the kernel's records, never the client's copy. */
export interface ContextMessageV1 {
	role: 'user' | 'assistant';
	text: string;
	/** Resolved attachments for this message when continuing a waiting turn (3.5, 5.1, 5.2). */
	attachments?: ReadonlyArray<AttachedContentV1>;
}

/** One attachment read by the kernel as the person, given to the model as content from its source (3.5, 5.1). */
export interface AttachedContentV1 {
	source: string;
	link: ResourceLinkV1;
	content: unknown;
}

/**
 * The agent port's kernel half for one turn (3.2): the only way a runtime reaches the kernel. Every call runs
 * on the agent interface as `copilot` for the person, in the session's scope, with the turn's trace. Revoked
 * when the turn settles: every method then answers `COPILOT_PORT_REFUSED`.
 */
export interface CopilotAgentCapabilityV1 {
	call(name: string, input: unknown): Promise<CommandResult>;
	listCommands(): Promise<ToolDescriptorV1[]>;
	confirmation(notification: string): Promise<CommandResult>;
	/**
	 * A unit's composed text (7.3), sent to its submit once: answers `{ unit, state }` alone, never the submit's result.
	 */
	unit(unit: string, text: unknown): Promise<CommandResult>;
	/**
	 * A unit of this turn being composed: the context its composer's requests must send, which the model port's half
	 * checks and counts toward the unit (7.3, 4.4). Undefined for none.
	 */
	composing(unit: string): { system: string; message: string } | undefined;
	/** Journals a refused port message (`COPILOT_PORT_REFUSED`), naming its keys and never its values. */
	refuse(reason: string, keys: readonly string[]): Promise<CommandResult>;
}

/** A confirmation as the panel's card draws it (6.2): the kernel's record, never the runtime's word. */
export interface CopilotConfirmationCardV1 {
	id: string;
	state: 'pending' | 'confirmed' | 'declined' | 'expired' | 'withdrawn';
	title: string;
	header: string;
	prompt: string;
	command: string;
	/** The validated input as it will run, or its size past the list's bound. */
	input: unknown;
	scope: ScopeV1;
	danger: boolean;
	asked?: ConfirmationAskedV1;
	/** A mounted command's preview, the person's to read (7.2). */
	preview?: ConfirmationPreviewV1;
	expiresAt: number;
	/** The copilot session that raised it: the port and the cards take only their own session's (6.2). */
	session?: string;
	/** The copilot call that raised it, by its turn and call id. */
	raisedBy?: { turn: number; call: string };
}

/** A suggestion as the panel's card draws it: the kernel's record (6.1). */
export interface CopilotSuggestionCardV1 {
	id: string;
	command: string;
	input: unknown;
	scope: ScopeV1;
	reasons: SuggestionV1['reasons'];
	sources: string[];
	expiresAt: number;
	ran: boolean;
}

/** How a turn ended, as the panel port's main half saw the runtime's events. */
export interface CopilotTurnOutcomeV1 {
	state: 'done' | 'failed' | 'stopped';
	reply: string;
	usage: { inputTokens: number; outputTokens: number };
	failure?: { code: string };
	stoppedBy?: 'person' | 'limit' | 'session-changed';
	/** The model rounds the turn has used, its earlier runs' included, counted on the trusted side (4.4). */
	rounds?: number;
	/** The output tokens its unit composers used, within `usage`, apart from the turn's output limit (7.3, 4.4). */
	unitOutput?: number;
}

/** One turn for the host to run (3.5, 4.3). */
export interface CopilotRunV1 {
	session: CopilotSessionV1;
	turn: number;
	/** The panel port's run, which `abort(runId)` stops. */
	runId: string;
	provider: CopilotProviderV1;
	history: ReadonlyArray<ContextMessageV1>;
	text: string;
	/** Resolved attachments read as the person, given to the model as content blocks (3.5, 5.1, 5.2). */
	attachments?: ReadonlyArray<AttachedContentV1>;
	agent: CopilotAgentCapabilityV1;
	/** The trusted host reports the end here; the first report wins and later ones are ignored. */
	settle(outcome: CopilotTurnOutcomeV1): void;
	/** Aborted when the person stops the turn, or the frame is removed. */
	signal: AbortSignal;
	/**
	 * What the turn spent in its earlier runs, when this run continues a turn that waited (3.5): the host counts 4.4's
	 * tokens and rounds on from it, so a continuation keeps the turn's limits.
	 */
	spent?: {
		usage: { inputTokens: number; outputTokens: number };
		rounds: number;
		unitOutput?: number;
	};
}

/** The host that runs turns: the web host's frame, or an in-process runtime in tests. */
export interface CopilotRunnerV1 {
	start(run: CopilotRunV1): void;
	/**
	 * Remove every runtime, as a change of person or a sign-out does (3.2): the kernel calls it once it has stopped
	 * every running turn as `session-changed`.
	 */
	reset?(): void;
}

/**
 * The kernel's copilot option (kernel interface 5): the deployment's providers, never a key or an endpoint,
 * and the runner. Absent, no provider is configured and no turn runs (`COPILOT_PROVIDER_MISSING`).
 */
export interface CopilotOptionsV1 {
	providers: ReadonlyArray<CopilotProviderV1>;
	/** The provider a new session takes. Default: the first. */
	default?: string;
	runner?: CopilotRunnerV1;
	/**
	 * The run id for a session's next turn, when the panel's `ChatClient` already chose one. Read once by the
	 * next `copilot-message-send` of that session; otherwise the kernel makes one.
	 */
	takeRunId?(session: string): string | undefined;
}

// ─── The ports' messages (3.2) ─────────────────────────────────────────────────

/**
 * Each port message's keys, by its `key`. A main-frame half refuses any message whose `key` it does not define,
 * or which carries a key outside its row (`COPILOT_PORT_REFUSED`, journaled for the agent port).
 */
export const AGENT_PORT_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	call: Object.freeze(['id', 'key', 'name', 'input']),
	listCommands: Object.freeze(['id', 'key']),
	confirmation: Object.freeze(['id', 'key', 'notification']),
	// A unit's composed text (7.3).
	unit: Object.freeze(['id', 'key', 'unit', 'text']),
});

export const MODEL_PORT_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	// `unit`, optional: a unit composer's request, counted toward its unit (7.3, 4.4).
	send: Object.freeze(['id', 'key', 'provider', 'body', 'unit']),
	cancel: Object.freeze(['key', 'stream']),
});

/**
 * What the runtime may send on the panel port: a run's AG-UI events, and its end. `RUN_FINISHED` repeats within a
 * run (once per model round), so the run's end is a message of its own. Its usage is never the runtime's word: the
 * model port's half counts it from the provider's stream.
 */
export const PANEL_PORT_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	event: Object.freeze(['key', 'runId', 'event']),
	end: Object.freeze(['key', 'runId', 'state', 'code']),
});

/**
 * The AG-UI events the panel port's half forwards to the panel, each with only these fields, each a string. Every
 * other type is dropped, and every other field: an interrupt (a `RUN_FINISHED` outcome), a `CUSTOM` event
 * (`ui-resource` included), a tool call's approval state and a state or messages snapshot never reach the panel
 * (3.2). A `CUSTOM` event named `loam-confirmation` only prompts the panel to read the session's records again.
 */
export const PANEL_EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	RUN_STARTED: Object.freeze(['runId', 'threadId']),
	RUN_FINISHED: Object.freeze(['runId', 'threadId']),
	RUN_ERROR: Object.freeze(['message', 'code']),
	// Never the runtime's `role`: the half sets `assistant`, so the model's text is never drawn as the person's.
	TEXT_MESSAGE_START: Object.freeze(['messageId']),
	TEXT_MESSAGE_CONTENT: Object.freeze(['messageId', 'delta']),
	TEXT_MESSAGE_END: Object.freeze(['messageId']),
	TOOL_CALL_START: Object.freeze(['toolCallId', 'toolCallName', 'parentMessageId']),
	TOOL_CALL_ARGS: Object.freeze(['toolCallId', 'delta']),
	TOOL_CALL_END: Object.freeze(['toolCallId']),
	TOOL_CALL_RESULT: Object.freeze(['toolCallId', 'messageId', 'content']),
	STEP_STARTED: Object.freeze(['stepName']),
	STEP_FINISHED: Object.freeze(['stepName']),
});

/** A message's own refusal on a port with no journal of its own (the model and panel ports). */
export interface PortRefusalV1 {
	key: 'refused';
	id?: number;
	error: { code: 'COPILOT_PORT_REFUSED'; message: string; suggestion: string };
}

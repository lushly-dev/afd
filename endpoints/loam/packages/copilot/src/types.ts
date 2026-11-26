/**
 * @fileoverview The runtime adapter's interface (phase 5 specification, 4.3) and the ports as the runtime sees them
 * (3.2). This package never imports the kernel: the shapes here are the runtime's own, and the kernel's halves check
 * every message they receive.
 */

/** A provider as the runtime is told it: never a key or an endpoint (4.1). */
export interface CopilotProviderV1 {
	id: string;
	kind: 'anthropic' | 'openai' | 'openai-compatible' | 'test';
	model: string;
}

/** The session as the runtime needs it: its id is `ChatClient`'s thread id. */
export interface CopilotSessionRefV1 {
	id: string;
}

/** A message of the history, built from the kernel's records (5.2), never the panel's copy. */
export interface ContextMessageV1 {
	role: 'user' | 'assistant';
	text: string;
	/** Resolved attachments for this message when continuing a waiting turn (3.5, 5.1, 5.2). */
	attachments?: ReadonlyArray<AttachedContentV1>;
}

/** One attachment read by the kernel as the person, given to the model as content from its source (3.5, 5.1). */
export interface AttachedContentV1 {
	source: string;
	link: Record<string, unknown>;
	content: unknown;
}

/** A tool the model is offered (4.5). */
export interface ToolDescriptorV1 {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** A `per-part` instance's description: its server's claim, given in a claim block (5.2). */
	claim?: { source: string };
}

/** A command's result, as the agent port returns it. */
export interface CommandResultLike {
	success: boolean;
	data?: unknown;
	error?: { code: string; message?: string; suggestion?: string };
	[key: string]: unknown;
}

/** The agent port's runtime half (3.2). */
export interface AgentPortV1 {
	call(name: string, input: unknown): Promise<CommandResultLike>;
	listCommands(): Promise<ToolDescriptorV1[]>;
	confirmation(notification: string): Promise<CommandResultLike>;
	/** A unit's composed text, for the kernel to send to its submit (7.3); `''` when the composer gave none. */
	unit(unit: string, text: string): Promise<CommandResultLike>;
}

/** The model port's runtime half (4.2): a `fetch` that keeps only the body and sends it to the trusted host. */
export interface ModelPortV1 {
	/** `unit`: a unit composer's request, which the kernel counts toward the unit, never the turn's rounds (7.3, 4.4). */
	fetchFor(provider: CopilotProviderV1, options?: { unit?: string }): typeof fetch;
}

/** An AG-UI event, as TanStack AI emits it. */
export type AgUiEventV1 = { type: string; [key: string]: unknown };

/** 4.3's runtime adapter. TanStack AI is behind it, its types kept inside the adapter. */
export interface CopilotRuntimeV1 {
	turn(
		input: {
			session: CopilotSessionRefV1;
			runId: string;
			provider: CopilotProviderV1;
			history: ReadonlyArray<ContextMessageV1>;
			text: string;
			attachments?: ReadonlyArray<AttachedContentV1>;
			tools: ReadonlyArray<ToolDescriptorV1>;
		},
		ports: { agent: AgentPortV1; model: ModelPortV1; signal: AbortSignal }
	): AsyncIterable<AgUiEventV1>;
}

/** A `MessagePort`, as the DOM, a worker and Node give one. */
export interface PortLike {
	postMessage(message: unknown): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	close?(): void;
}

/** A session's three ports, the runtime's halves. */
export interface RuntimePortsV1 {
	agent: PortLike;
	model: PortLike;
	panel: PortLike;
}

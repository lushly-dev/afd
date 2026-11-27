/**
 * @fileoverview `mailfix` mounted in a kernel in this process (phase 5 specification, Jobs and scenarios, `p5-base`):
 * its manifest, its deployment entry, a transport that answers the kernel's discovery and calls from the server in
 * memory, and `mailfixapp`, the native fixture app whose `calls` grant names `mailfix`'s draft and send (7.5).
 *
 * **The transport.** The kernel's units have no MCP client, so {@link mailfixTransport} answers what the kernel's
 * discovery and calls send (`afd-help`, `afd-detail`, a first-class tool) from the `McpServer` itself: `afd-help`
 * through its own `execute`, `afd-detail` from its registered definitions as AFD's `executeDetail` builds an entry,
 * and a tool by `execute`, answered as `structuredContent` beside a text duplicate, as AFD's server sends both. The
 * desktop suite mounts the same server over stdio (`mailfix-stdio.ts`), and Chromium through the test relay.
 *
 * **The approver.** With `approver` (the default), the transport plays AFD's carrier as an MCP 2026-07-28 lane does for
 * a caller the server names an approver (step 0c): a held send's `APPROVAL_REQUIRED` carries `details.approvalToken`,
 * and a call whose `_meta` holds `dev.afd/approval` runs with it as the evidence. The server's own approval middleware
 * still checks the token, its command, input and single use. Kernel units and the desktop suite also run the real
 * carrier over MCP (`mounted-approvals.test.ts`, the desktop's P5-A6).
 *
 * **The entry** says `labels = "per-part"` (5.1) and `approvals = "shell"` (7.2), names the mutations the scenarios
 * call, each exposed to agents, and gives the send its preview, `mailfix-draft-show` of its `draft`; the draft and send
 * are exposed to apps too, for `mailfixapp`'s grant (7.5).
 */

import type { ApprovalRequest, McpServer } from '@lushly-dev/afd-server';
import type { ManifestV3 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1 } from '@lushly-dev/loam-sdk';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import type { McpToolCallResult, MountTransport } from '../src/types.js';
import { createMailfixServer, type MailfixServerOptions } from './mailfix.js';

/** `mailfix`'s manifest: a mounted app of the fixture's one domain. */
export const MAILFIX_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'mailfix',
		title: 'Mailfix',
		version: '0.1.0',
		description: 'A fixture mail server, mounted for the scenarios.',
		kind: 'mounted',
		domains: ['mailfix'],
	},
	mount: { prefix: 'mailfix', transport: 'http' },
} as unknown as ManifestV3;

/** The commands `mailfix`'s entry names under `commands`: its mutations, each as a deployer chose to expose it. */
export const MAILFIX_NAMED: Readonly<Record<string, { agent: boolean; apps?: true }>> =
	Object.freeze({
		'mailfix-thread-open': { agent: true, apps: true },
		// Milestone B's (9.4's second amendment): `mailfixapp` lists threads through its grant.
		'mailfix-thread-list': { agent: true, apps: true },
		'mailfix-thread-archive': { agent: true },
		'mailfix-thread-unarchive': { agent: true },
		'mailfix-draft-create': { agent: true, apps: true },
		'mailfix-draft-update': { agent: true },
		'mailfix-draft-send': { agent: true, apps: true },
		'mailfix-replyset-submit': { agent: true },
	});

/** The send's preview (7.2): the draft as it would be sent, by the draft the send names. */
export const MAILFIX_SEND_PREVIEW = Object.freeze({
	command: 'mailfix-draft-show',
	input: Object.freeze(['draft']),
});

/** `mailfix`'s deployment entry, as a projection lists it; `approvals = "shell"` by default (7.2). */
export function mailfixEntry(
	order: number,
	labels: 'whole' | 'per-part' = 'per-part',
	instance = 'mailfix',
	approvals: 'none' | 'shell' = 'shell'
): Record<string, unknown> {
	return {
		instance,
		app: 'mailfix',
		package: `apps/${instance}/`,
		order,
		prefix: instance,
		audience: 'person',
		transport: 'http',
		route: `mounts/${instance}/mcp`,
		labels,
		approvals,
		commands: Object.fromEntries(
			Object.entries(MAILFIX_NAMED).map(([name, expose]) => [
				name.replace(/^mailfix-/, `${instance}-`),
				{
					expose,
					...(name === 'mailfix-draft-send'
						? {
								preview: {
									command: MAILFIX_SEND_PREVIEW.command.replace(/^mailfix-/, `${instance}-`),
									input: [...MAILFIX_SEND_PREVIEW.input],
								},
							}
						: {}),
				},
			])
		),
	};
}

const asResult = (body: unknown): McpToolCallResult => ({
	structuredContent: body,
	content: [{ type: 'text', text: JSON.stringify(body) }],
});

/** A transport over `server` in this process: what the kernel's discovery and calls read (the file's header). */
export function mailfixTransport(
	server: McpServer,
	options: { textOnly?: boolean; approver?: boolean; held?: ApprovalRequest[] } = {}
): MountTransport & {
	calls: Array<{ tool: string; args: unknown; meta?: Record<string, unknown> }>;
} {
	const calls: Array<{ tool: string; args: unknown; meta?: Record<string, unknown> }> = [];
	const approver = options.approver !== false;
	const held = options.held ?? [];
	const answer = (body: unknown): McpToolCallResult =>
		options.textOnly ? { content: [{ type: 'text', text: JSON.stringify(body) }] } : asResult(body);
	/** A held send's answer, as the carrier gives an approver: with the token the server issued for this very call. */
	const carried = (body: unknown, issued: number): unknown => {
		const result = body as { success?: boolean; error?: { code?: string; details?: object } };
		const request = held[issued];
		if (
			!approver ||
			result.success !== false ||
			result.error?.code !== 'APPROVAL_REQUIRED' ||
			!request
		)
			return body;
		return {
			...result,
			error: {
				...result.error,
				details: { ...result.error.details, approvalToken: request.approvalToken },
			},
		};
	};
	const run = async (tool: string, input: unknown, meta?: Record<string, unknown>) => {
		const evidence = approver ? meta?.['dev.afd/approval'] : undefined;
		const issued = held.length;
		const body = await server.execute(
			tool,
			input ?? {},
			typeof evidence === 'string' ? { approval: evidence } : undefined
		);
		return answer(carried(body, issued));
	};
	return {
		calls,
		// The lane the desktop's stdio transport opens for an `approvals = "shell"` instance (7.2): 2026-07-28, the
		// carrier's era (AFD's rule 3), by the transport's own word. Whether the server names this peer an approver is
		// `approver`'s, apart.
		connect: async () => ({ protocolVersion: '2026-07-28', approvals: true as const }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args, _signal, meta) {
			calls.push({ tool, args, ...(meta ? { meta } : {}) });
			if (tool === 'afd-help') return asResult(await server.execute('afd-help', args ?? {}));
			if (tool === 'afd-detail') {
				const asked = (args as { command?: unknown } | null)?.command;
				const names = Array.isArray(asked) ? asked : [asked];
				const byName = new Map(server.getCommands().map((command) => [command.name, command]));
				return asResult({
					success: true,
					data: names.map((name) => {
						const command = byName.get(String(name));
						if (!command) return { name, found: false };
						return {
							name: command.name,
							found: true,
							callable: true,
							title: command.title,
							description: command.description,
							mutation: command.mutation ?? false,
							inputSchema: command.jsonSchema,
							destructive: command.destructive,
							undoable: command.undoable,
							approval:
								command.approval === 'required' || typeof command.approval === 'function'
									? 'required'
									: command.approval,
						};
					}),
				});
			}
			if (tool === 'afd-call') {
				const { command, input } = (args ?? {}) as { command?: string; input?: unknown };
				return run(String(command), input, meta);
			}
			return run(tool, args, meta);
		},
		async close() {},
	};
}

/**
 * A fresh `mailfix` and its transport, for one kernel. `held` lists each send the server held, with the token it issued,
 * so a test can look for every token where none may be (P5-A6).
 */
export function mountedMailfix(
	options: Omit<MailfixServerOptions, 'approver'> & { textOnly?: boolean; approver?: boolean } = {}
) {
	const held: ApprovalRequest[] = [];
	const { approver: _approver, textOnly: _textOnly, ...serverOptions } = options;
	const server = createMailfixServer({
		...serverOptions,
		onApprovalRequired: async (request) => {
			held.push(request);
			await options.onApprovalRequired?.(request);
		},
	});
	return { server, held, transport: mailfixTransport(server, { ...options, held }) };
}

/**
 * `mailfixapp` (7.5): a native fixture app standing in for mail's own app, holding a `calls` grant that names
 * `mailfix`'s draft and send. Its one query, `mailfixapp-thread-peek`, reads a thread through `mailfix` and returns
 * the sender's text unlabelled, as an app that drops a mount's labels would: P5-A4's "a native app returning its
 * mount's text unlabelled taints through the trace". `mailfixapp-other-peek` reads `mailfixb`'s thread, another
 * instance, which a tainted turn's call must ask before (L2).
 */
export const MAILFIXAPP_MANIFEST = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'mailfixapp',
		title: 'Mailfix app',
		version: '0.1.0',
		description: "A fixture app over mailfix, standing in for mail's own app.",
		kind: 'native',
		domains: ['mailfixapp'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [
		{ name: 'calls', reason: "Drafts and sends the person's replies through mailfix." },
		// Milestone B's (9.4's second amendment): it catches up on what changed in its engine (9.2).
		{ name: 'events', reason: 'Refreshes when mailfix changes through the shell.' },
	],
	calls: [
		{
			app: 'mailfix',
			commands: [
				'mailfix-thread-open',
				'mailfix-thread-list',
				'mailfix-draft-create',
				'mailfix-draft-send',
			],
		},
		{ app: 'mailfix', commands: ['mailfixb-thread-open'] },
	],
	commands: [
		{
			name: 'mailfixapp-thread-peek',
			title: 'Peek at a thread',
			description: "Read a thread's text through mailfix.",
			effects: ['inspect'],
			input_schema: {
				type: 'object',
				properties: { thread: { type: 'string', minLength: 1, maxLength: 64 } },
				required: ['thread'],
				additionalProperties: false,
			},
		},
		{
			name: 'mailfixapp-client-keep',
			title: 'Keep the client',
			description: "Keep this call's client past its return, as a misbehaving app might.",
			effects: ['inspect'],
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
		},
		{
			name: 'mailfixapp-other-peek',
			title: 'Peek at the other mailbox',
			description: "Read a thread's text through mailfixb.",
			effects: ['inspect'],
			input_schema: {
				type: 'object',
				properties: { thread: { type: 'string', minLength: 1, maxLength: 64 } },
				required: ['thread'],
				additionalProperties: false,
			},
		},
	],
} as unknown as ManifestV3;

/** What a thread's first message says, with its label dropped. */
const textOf = (data: unknown): string =>
	String(
		(data as { messages?: Array<{ content?: { text?: unknown } }> } | undefined)?.messages?.[0]
			?.content?.text ?? ''
	);

/** The client `mailfixapp-client-keep` kept past its call, for a test to call through (B12). */
export const KEPT: { client?: { call(name: string, input?: unknown): Promise<unknown> } } = {};

export const MAILFIXAPP_DEFINITION: AppDefinitionV1 = defineApp({
	sdk: 1,
	handlers: {
		'mailfixapp-thread-peek': async (input: { thread: string }, context) => {
			const read = await context.client.call('mailfix-thread-open', { thread: input.thread });
			if (!read.success) return read;
			return success({ text: textOf(read.data) });
		},
		'mailfixapp-client-keep': async (_input: unknown, context) => {
			KEPT.client = context.client as never;
			return success({ kept: true });
		},
		'mailfixapp-other-peek': async (input: { thread: string }, context) => {
			const read = await context.client.call('mailfixb-thread-open', { thread: input.thread });
			if (!read.success) return read;
			return success({ text: textOf(read.data) });
		},
	},
});

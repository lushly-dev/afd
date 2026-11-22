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
 * **The entry** says `labels = "per-part"` (5.1) and names the mutations the scenarios call, each exposed to agents;
 * the draft and send are exposed to apps too, for `mailfixapp`'s grant (7.5). `approvals` is step 5's.
 */

import type { McpServer } from '@lushly-dev/afd-server';
import type { ManifestV2 } from '@lushly-dev/loam-manifest';
import type { AppDefinitionV1 } from '@lushly-dev/loam-sdk';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import type { McpToolCallResult, MountTransportV2 } from '../src/types.js';
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
} as unknown as ManifestV2;

/** The commands `mailfix`'s entry names under `commands`: its mutations, each as a deployer chose to expose it. */
export const MAILFIX_NAMED: Readonly<Record<string, { agent: boolean; apps?: true }>> =
	Object.freeze({
		'mailfix-thread-open': { agent: true, apps: true },
		'mailfix-thread-archive': { agent: true },
		'mailfix-thread-unarchive': { agent: true },
		'mailfix-draft-create': { agent: true, apps: true },
		'mailfix-draft-update': { agent: true },
		'mailfix-draft-send': { agent: true, apps: true },
		'mailfix-replyset-submit': { agent: true },
	});

/** `mailfix`'s deployment entry, as a projection lists it. */
export function mailfixEntry(
	order: number,
	labels: 'whole' | 'per-part' = 'per-part',
	instance = 'mailfix'
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
		commands: Object.fromEntries(
			Object.entries(MAILFIX_NAMED).map(([name, expose]) => [
				name.replace(/^mailfix-/, `${instance}-`),
				{ expose },
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
	options: { textOnly?: boolean } = {}
): MountTransportV2 & { calls: Array<{ tool: string; args: unknown }> } {
	const calls: Array<{ tool: string; args: unknown }> = [];
	const answer = (body: unknown): McpToolCallResult =>
		options.textOnly ? { content: [{ type: 'text', text: JSON.stringify(body) }] } : asResult(body);
	return {
		calls,
		connect: async () => ({ protocolVersion: '2025-11-25' }),
		listTools: () => Promise.reject(new Error('Discovery lists no tools')),
		async callTool(tool, args) {
			calls.push({ tool, args });
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
				return answer(await server.execute(String(command), input ?? {}));
			}
			return answer(await server.execute(tool, args ?? {}));
		},
		async close() {},
	};
}

/** A fresh `mailfix` and its transport, for one kernel. */
export function mountedMailfix(options: MailfixServerOptions & { textOnly?: boolean } = {}) {
	const server = createMailfixServer(options);
	return { server, transport: mailfixTransport(server, options) };
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
	grants: [{ name: 'calls', reason: "Drafts and sends the person's replies through mailfix." }],
	calls: [
		{
			app: 'mailfix',
			commands: ['mailfix-thread-open', 'mailfix-draft-create', 'mailfix-draft-send'],
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
} as unknown as ManifestV2;

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

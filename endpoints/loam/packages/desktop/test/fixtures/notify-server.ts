/**
 * P6-D2's `stdio` fixture: an AFD server over stdio whose `fixture-notify` writes, before its answer, a
 * notification carrying a hostile payload, one over 1 MiB, and a server-to-client request; and whose
 * `fixture-pid` answers its process id, so the suite can kill it. Run by Node, which strips its types.
 */
import { success } from '@lushly-dev/afd-core';
import { createMcpServer, defineCommand } from '@lushly-dev/afd-server';
import { z } from 'zod';
import { HOSTILE } from './hostile.ts';

const line = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

const notify = defineCommand({
	name: 'fixture-notify',
	description: 'Writes three server messages, then answers',
	mutation: false,
	expose: { mcp: true, palette: true, agent: true },
	input: z.object({}),
	async handler() {
		line({
			jsonrpc: '2.0',
			method: 'notifications/message',
			params: { level: 'info', data: HOSTILE, [HOSTILE]: [HOSTILE] },
		});
		line({
			jsonrpc: '2.0',
			method: 'notifications/message',
			params: { level: 'info', data: 'x'.repeat(1024 * 1024 + 1) },
		});
		line({ jsonrpc: '2.0', id: 'server-request', method: 'roots/list' });
		return success({ sent: 3 });
	},
});

const pid = defineCommand({
	name: 'fixture-pid',
	description: 'Answers this process id',
	mutation: false,
	expose: { mcp: true, palette: true, agent: true },
	input: z.object({}),
	async handler() {
		return success({ pid: process.pid });
	},
});

await createMcpServer({
	name: 'fixture',
	version: '1.0.0',
	commands: [notify, pid],
	transport: 'stdio',
	toolStrategy: 'hybrid',
	// `afd-help` and `afd-detail`, which the kernel's discovery reads.
	bootstrap: true,
	firstClassTools: ['fixture-notify', 'fixture-pid'],
}).start();

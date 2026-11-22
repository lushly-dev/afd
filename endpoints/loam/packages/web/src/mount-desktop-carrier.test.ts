/**
 * The desktop's transport against AFD's real approver carrier (phase 5 specification, 7.2; step 0c), with the Rust host
 * stood in for by a pipe to the process it would start: `mailfix` over stdio (`kernel/scenarios/mailfix-stdio.ts`),
 * which names its stdio peer an approver. What it proves: the 2026-07-28 opening and request keys the transport sends
 * are what AFD's dual-era stdio lane accepts; a held send's answer carries the token to this peer alone, and the
 * kernel's retry message, with `_meta["dev.afd/approval"]` beside its scope, runs it once. What it does not prove: the
 * Rust host's own carrying of the lines (the desktop suite's P5-A6), or the kernel (its units).
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopMountTransport, DESKTOP_MODERN_VERSION } from './mount-desktop.js';

const KERNEL = fileURLToPath(new URL('../../kernel/', import.meta.url));
const ENTRY = fileURLToPath(new URL('../../kernel/scenarios/mailfix-stdio.ts', import.meta.url));
const held = globalThis as { __TAURI_INTERNALS__?: { invoke: unknown } };
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
	delete held.__TAURI_INTERNALS__;
	for (const child of children.splice(0)) child.kill();
});

/** A Rust host of one stdio instance: `mount_open` starts it, `mount_send` writes a line and answers its reply. */
function pipeHost(env: Record<string, string> = {}) {
	const waiting = new Map<number, (message: unknown) => void>();
	let child: ChildProcessWithoutNullStreams | undefined;
	held.__TAURI_INTERNALS__ = {
		async invoke(command: string, args: { message?: { id?: number } }) {
			if (command === 'mount_open') {
				child = spawn(process.execPath, [ENTRY], {
					cwd: KERNEL,
					env: { ...process.env, ...env },
					stdio: ['pipe', 'pipe', 'pipe'],
				});
				children.push(child);
				child.stderr.resume();
				let buffer = '';
				child.stdout.setEncoding('utf8');
				child.stdout.on('data', (chunk: string) => {
					buffer += chunk;
					for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
						const line = buffer.slice(0, end).trim();
						buffer = buffer.slice(end + 1);
						if (!line) continue;
						const message = JSON.parse(line) as { id?: number };
						if (typeof message.id === 'number') waiting.get(message.id)?.(message);
					}
				});
				return 1;
			}
			if (command === 'mount_close') return null;
			const message = args.message ?? {};
			child?.stdin.write(`${JSON.stringify(message)}\n`);
			if (typeof message.id !== 'number') return null;
			return new Promise((resolve) => waiting.set(message.id as number, resolve));
		},
	};
}

type Body = {
	success: boolean;
	data?: unknown;
	error?: { code: string; details?: { approvalToken?: string } };
};
const bodyOf = (result: { structuredContent?: unknown }) => result.structuredContent as Body;

describe("the desktop transport and AFD's approver carrier (7.2)", () => {
	it('opens on 2026-07-28, receives the token as the approver, and its retry with the key sends once', async () => {
		pipeHost();
		const transport = createDesktopMountTransport('mailfix', { era: 'modern' });
		expect(await transport.connect()).toEqual({
			protocolVersion: DESKTOP_MODERN_VERSION,
			approvals: true,
		});
		const scope = { 'dev.loam/scope': { workspace: 'personal' } };
		const call = async (command: string, input: unknown, meta: Record<string, unknown> = {}) =>
			bodyOf(
				await transport.callTool('afd-call', { command, input }, undefined, { ...scope, ...meta })
			);
		expect((await call('mailfix-draft-create', { thread: 'thr_1', body: 'Hi.' })).success).toBe(
			true
		);
		const hold = await call('mailfix-draft-send', { draft: 'drf_1', revision: 1 });
		expect(hold.error?.code).toBe('APPROVAL_REQUIRED');
		const token = hold.error?.details?.approvalToken;
		expect(token).toMatch(/^afdap1\./);
		expect((await call('mailfix-sent-list', {})).data).toEqual({ sent: [] });
		const sent = await call(
			'mailfix-draft-send',
			{ draft: 'drf_1', revision: 1 },
			{ 'dev.afd/approval': token }
		);
		expect(sent).toMatchObject({ success: true, data: { draft: 'drf_1' } });
		const again = await call(
			'mailfix-draft-send',
			{ draft: 'drf_1', revision: 1 },
			{ 'dev.afd/approval': token }
		);
		expect(again.success).toBe(false);
		expect(((await call('mailfix-sent-list', {})).data as { sent: unknown[] }).sent).toHaveLength(
			1
		);
		await transport.close();
	}, 30_000);

	it('gives no token to a peer the server does not name an approver', async () => {
		pipeHost({ LOAM_MAILFIX_APPROVER: '0' });
		const transport = createDesktopMountTransport('mailfix', { era: 'modern' });
		await transport.connect();
		await transport.callTool('afd-call', {
			command: 'mailfix-draft-create',
			input: { thread: 'thr_1', body: 'Hi.' },
		});
		const hold = bodyOf(
			await transport.callTool('afd-call', {
				command: 'mailfix-draft-send',
				input: { draft: 'drf_1', revision: 1 },
			})
		);
		expect(hold.error?.code).toBe('APPROVAL_REQUIRED');
		expect(hold.error?.details?.approvalToken).toBeUndefined();
		await transport.close();
	}, 30_000);
});

/**
 * The page's half of the desktop's inbound endpoint (phase 6 specification, 10.8): each `loam:inbound` event answered
 * through `inbound_reply` with the host's own id, a notification with nothing, `ready` once, and no Tauri IPC, nothing.
 */

import { createScopedWorkspace, type ScopedWorkspace } from '@lushly-dev/loam-kernel/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { INBOUND_EVENT, startInbound } from './inbound.js';

type Call = { command: string; args: Record<string, unknown> };
const made: ScopedWorkspace[] = [];
afterEach(async () => {
	await Promise.all(made.splice(0).map(({ kernel }) => kernel.dispose()));
});

/** A main frame: an event target with Tauri's IPC, each call recorded. */
function frame(withIpc = true) {
	const calls: Call[] = [];
	const target = new EventTarget() as EventTarget & { __TAURI_INTERNALS__?: unknown };
	if (withIpc)
		target.__TAURI_INTERNALS__ = {
			async invoke(command: string, args: Record<string, unknown>) {
				calls.push({ command, args });
				return null;
			},
		};
	return { target: target as unknown as Window, calls };
}

const until = async (check: () => boolean) => {
	for (let tries = 0; tries < 200 && !check(); tries++) await new Promise((r) => setTimeout(r, 5));
	expect(check()).toBe(true);
};

describe('startInbound (10.8)', () => {
	it('says it is ready, answers a request with the host’s id, and a notification with nothing', async () => {
		const workspace = await createScopedWorkspace();
		made.push(workspace);
		await workspace.kernel.appsReady;
		const { target, calls } = frame();
		const errors: unknown[] = [];
		const stop = await startInbound(target, workspace, (error) => errors.push(error));
		expect(calls).toEqual([{ command: 'inbound_reply', args: { ready: true } }]);
		target.dispatchEvent(
			new CustomEvent(INBOUND_EVENT, {
				detail: { id: 41, message: { jsonrpc: '2.0', id: 'c-1', method: 'ping' } },
			})
		);
		target.dispatchEvent(
			new CustomEvent(INBOUND_EVENT, {
				detail: { message: { jsonrpc: '2.0', method: 'notifications/initialized' } },
			})
		);
		await until(() => calls.length === 2);
		expect(calls[1]).toEqual({
			command: 'inbound_reply',
			args: { id: 41, message: { jsonrpc: '2.0', id: 'c-1', result: {} } },
		});
		// An id that is not the host's kind is never answered.
		target.dispatchEvent(
			new CustomEvent(INBOUND_EVENT, {
				detail: { id: 'x', message: { jsonrpc: '2.0', id: 1, method: 'ping' } },
			})
		);
		await new Promise((r) => setTimeout(r, 20));
		expect(calls).toHaveLength(2);
		stop();
		target.dispatchEvent(
			new CustomEvent(INBOUND_EVENT, {
				detail: { id: 42, message: { jsonrpc: '2.0', id: 2, method: 'ping' } },
			})
		);
		await new Promise((r) => setTimeout(r, 20));
		expect(calls).toHaveLength(2);
		expect(errors).toEqual([]);
	});

	it('asks again while the host refuses its ready, and says nothing after a failed stage B', async () => {
		const workspace = await createScopedWorkspace();
		made.push(workspace);
		await workspace.kernel.appsReady;
		const calls: Call[] = [];
		let refusals = 2;
		const target = new EventTarget() as EventTarget & { __TAURI_INTERNALS__?: unknown };
		target.__TAURI_INTERNALS__ = {
			async invoke(command: string, args: Record<string, unknown>) {
				calls.push({ command, args });
				return refusals-- > 0 ? false : true;
			},
		};
		await startInbound(
			target as unknown as Window,
			workspace,
			() => {},
			async () => {}
		);
		await until(() => calls.length === 3);
		await new Promise((r) => setTimeout(r, 20));
		expect(calls).toHaveLength(3);
		const { target: other, calls: none } = frame();
		const failed = {
			...workspace,
			kernel: { ...workspace.kernel, lateFailure: { code: 'LATE_UNAVAILABLE', message: 'x' } },
		} as unknown as typeof workspace;
		await startInbound(other, failed, () => {});
		expect(none).toEqual([]);
	});

	it('answers a request whose handling throws, so the client never waits out 60 s', async () => {
		const workspace = await createScopedWorkspace();
		made.push(workspace);
		await workspace.kernel.appsReady;
		const { target, calls } = frame();
		const errors: unknown[] = [];
		const broken = {
			...workspace,
			inboundCommands: () => {
				throw new Error('no commands');
			},
		} as unknown as typeof workspace;
		await startInbound(target, broken, (error) => errors.push(error));
		target.dispatchEvent(
			new CustomEvent(INBOUND_EVENT, {
				detail: { id: 5, message: { jsonrpc: '2.0', id: 'c', method: 'tools/list' } },
			})
		);
		await until(() => calls.length === 2);
		expect(calls[1]).toMatchObject({
			command: 'inbound_reply',
			args: { id: 5, message: { id: 'c', error: { code: -32603 } } },
		});
	});

	it('does nothing where the page has no Tauri IPC', async () => {
		const workspace = await createScopedWorkspace();
		made.push(workspace);
		const { target, calls } = frame(false);
		await startInbound(target, workspace, () => {});
		expect(calls).toEqual([]);
	});
});

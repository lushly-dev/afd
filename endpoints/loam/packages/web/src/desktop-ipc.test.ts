import { createScopedWorkspace, type ScopedWorkspace } from '@lushly-dev/loam-kernel/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopModelTransport, createHostTransport } from './copilot.js';
import { captureDesktopInvoke } from './desktop-ipc.js';
import { startInbound } from './inbound.js';
import { createDesktopMountTransport } from './mount-desktop.js';
import { createSessionRefresh } from './session-refresh.js';

const workspaces: ScopedWorkspace[] = [];
const heldGlobal = globalThis as { __TAURI_INTERNALS__?: unknown };

afterEach(async () => {
	delete heldGlobal.__TAURI_INTERNALS__;
	await Promise.all(workspaces.splice(0).map(({ kernel }) => kernel.dispose()));
});

describe('captureDesktopInvoke', () => {
	it('retains the boot-captured invoke function and receiver reference even if __TAURI_INTERNALS__ is later mutated', async () => {
		const seen: Array<{ self: unknown; command: string; args: Record<string, unknown> }> = [];
		const internals = {
			tag: 'tauri',
			async invoke(this: unknown, command: string, args: Record<string, unknown>) {
				seen.push({ self: this, command, args });
				return 'ok';
			},
		};
		const host: { __TAURI_INTERNALS__?: unknown } = { __TAURI_INTERNALS__: internals };
		const captured = captureDesktopInvoke(host);
		expect(captured).toBeTypeOf('function');

		// Note: this tests Loam's own captured function + receiver retention; Tauri 2.12.7's real `invoke`
		// still reads `window.__TAURI_INTERNALS__.ipc` internally on each call (D54 non-isolation).
		host.__TAURI_INTERNALS__ = {
			invoke: () => Promise.reject(new Error('replaced')),
		};
		expect(await captured?.('mount_open', { instance: 'home' })).toBe('ok');
		delete host.__TAURI_INTERNALS__;
		expect(await captured?.('mount_close', { handle: 1 })).toBe('ok');
		expect(seen).toEqual([
			{ self: internals, command: 'mount_open', args: { instance: 'home' } },
			{ self: internals, command: 'mount_close', args: { handle: 1 } },
		]);
	});

	it('returns null when __TAURI_INTERNALS__ or its invoke function is absent', () => {
		expect(captureDesktopInvoke(undefined)).toBeNull();
		expect(captureDesktopInvoke(null)).toBeNull();
		expect(captureDesktopInvoke({})).toBeNull();
		expect(captureDesktopInvoke({ __TAURI_INTERNALS__: null })).toBeNull();
		expect(captureDesktopInvoke({ __TAURI_INTERNALS__: { invoke: 'nope' } })).toBeNull();
	});

	it('flows the boot-captured invoker through mount, model, and inbound consumers after target mutation', async () => {
		const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
		const target = new EventTarget() as EventTarget & { __TAURI_INTERNALS__?: unknown };
		target.__TAURI_INTERNALS__ = {
			async invoke(command: string, args: Record<string, unknown>) {
				calls.push({ command, args });
				if (command === 'mount_open') return 42;
				if (command === 'mount_send') {
					const msg = args.message as { id?: number; method: string };
					if (msg.method === 'initialize') {
						return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18' } };
					}
					return null;
				}
				if (command === 'model_send') return Promise.reject('COPILOT_KEY_MISSING');
				return true;
			},
		};
		const invoke = captureDesktopInvoke(target);
		expect(invoke).toBeTypeOf('function');

		// Remove the global after boot before lazy chunks instantiate their transports.
		delete target.__TAURI_INTERNALS__;

		const session = createSessionRefresh('loam://localhost/', invoke);
		const chunk = await session.mountChunk();
		const mount = chunk.createDesktopMountTransport('home');
		expect(await mount.connect()).toEqual({ protocolVersion: '2025-06-18' });
		await mount.close();

		const directMount = createDesktopMountTransport('home', { invoke });
		expect(await directMount.connect()).toEqual({ protocolVersion: '2025-06-18' });
		await directMount.close();

		const model = createDesktopModelTransport(target as unknown as Window, invoke);
		await expect(
			model.send(
				{ id: 'local', kind: 'openai-compatible', model: 'm' },
				{},
				new AbortController().signal
			)
		).rejects.toMatchObject({ code: 'COPILOT_KEY_MISSING' });
		const hostTransport = createHostTransport(target as unknown as Window, {}, invoke);
		await expect(
			hostTransport.send(
				{ id: 'local', kind: 'openai-compatible', model: 'm' },
				{},
				new AbortController().signal
			)
		).rejects.toMatchObject({ code: 'COPILOT_KEY_MISSING' });

		const workspace = await createScopedWorkspace();
		workspaces.push(workspace);
		await workspace.kernel.appsReady;
		const stop = await startInbound(
			target as unknown as Window,
			workspace,
			() => {},
			async () => {},
			invoke
		);
		stop();

		expect(calls.map((c) => c.command)).toEqual([
			'mount_open',
			'mount_send',
			'mount_send',
			'mount_close',
			'mount_open',
			'mount_send',
			'mount_send',
			'mount_close',
			'model_send',
			'model_send',
			'inbound_reply',
		]);
	});

	it('preserves absent-at-boot (null) so a bridge added after boot receives zero calls', async () => {
		const target = new EventTarget() as EventTarget & { __TAURI_INTERNALS__?: unknown };
		const invoke = captureDesktopInvoke(target);
		expect(invoke).toBeNull();

		// Inject a fake bridge on both `target` and `globalThis` AFTER boot capture.
		const lateCalls: string[] = [];
		const lateBridge = {
			async invoke(command: string) {
				lateCalls.push(command);
				return 1;
			},
		};
		target.__TAURI_INTERNALS__ = lateBridge;
		heldGlobal.__TAURI_INTERNALS__ = lateBridge;

		const session = createSessionRefresh('https://loam.example/', invoke);
		const chunk = await session.mountChunk();
		await expect(chunk.createDesktopMountTransport('home').connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});
		await expect(createDesktopMountTransport('home', { invoke }).connect()).rejects.toMatchObject({
			code: 'MOUNT_UNREACHABLE',
		});

		const hostTransport = createHostTransport(target as unknown as Window, {}, invoke);
		await expect(
			hostTransport.send(
				{ id: 'local', kind: 'openai-compatible', model: 'm' },
				{},
				new AbortController().signal
			)
		).rejects.toMatchObject({ code: 'COPILOT_PROVIDER_UNKNOWN' });

		const modelTransport = createDesktopModelTransport(target as unknown as Window, invoke);
		await expect(
			modelTransport.send(
				{ id: 'local', kind: 'openai-compatible', model: 'm' },
				{},
				new AbortController().signal
			)
		).rejects.toMatchObject({ code: 'MODEL_UNREACHABLE' });

		const workspace = await createScopedWorkspace();
		workspaces.push(workspace);
		await workspace.kernel.appsReady;
		const stop = await startInbound(
			target as unknown as Window,
			workspace,
			() => {},
			async () => {},
			invoke
		);
		stop();

		expect(lateCalls).toEqual([]);
	});
});

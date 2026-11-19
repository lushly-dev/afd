/**
 * The channel's gate (phase 4 specification, section 11's `messageBytes`; the trust review's 1 and 9): every message a
 * frame sends passes the kernel's `admit` before anything reads it, a refused request is answered with the refusal, a
 * refused reply fails the request it answers, a refused notification is dropped; and a refusal's details cross the frame.
 * Over a fake document and window, since the channel touches no more of them than this.
 */

import type { FrameAdmitV1 } from '@lushly-dev/loam-kernel';
import { describe, expect, it, vi } from 'vitest';
import { ChannelError, ProxyChannel, rpcErrorOf } from './channel.js';

const ORIGIN = 'https://sandbox.test';

function open(admit?: FrameAdmitV1) {
	const posted: unknown[] = [];
	const contentWindow = { postMessage: (message: unknown) => posted.push(message) };
	let listener: ((event: unknown) => void) | undefined;
	const view = {
		location: { origin: 'https://shell.test' },
		addEventListener: (_type: string, heard: (event: unknown) => void) => {
			listener = heard;
		},
		removeEventListener: () => {},
	};
	const frame = { setAttribute: () => {}, contentWindow, remove: () => {}, title: '', src: '' };
	const document = { defaultView: view, createElement: () => frame } as unknown as Document;
	const channel = new ProxyChannel({
		document,
		sandboxOrigin: ORIGIN,
		title: 'Probe',
		html: '<p>probe</p>',
		...(admit ? { admit } : {}),
	});
	const send = (data: unknown) => listener?.({ source: contentWindow, origin: ORIGIN, data });
	return { channel, posted, send };
}

const REFUSED = {
	code: 'INPUT_TOO_LARGE',
	rpcCode: -32600,
	message: 'A message from the frame is over 65536 bytes of JSON, so it was dropped',
	suggestion: 'Send less',
	details: { limit: 65_536 },
};

describe('the channel gate (section 11)', () => {
	it('calls admit first and answers a refused request with the refusal, never dispatching it', async () => {
		const admit = vi.fn<FrameAdmitV1>((message) =>
			JSON.stringify(message).length > 100 ? REFUSED : undefined
		);
		const { channel, posted, send } = open(admit);
		const onRequest = vi.fn(async () => ({ ok: true }));
		const onNotification = vi.fn();
		channel.onRequest = onRequest;
		channel.onNotification = onNotification;
		send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { pad: 'x'.repeat(200) } });
		send({ jsonrpc: '2.0', method: 'notifications/message', params: { pad: 'x'.repeat(200) } });
		await Promise.resolve();
		expect(onRequest).not.toHaveBeenCalled();
		expect(onNotification).not.toHaveBeenCalled();
		expect(posted).toEqual([
			{
				jsonrpc: '2.0',
				id: 7,
				error: {
					code: -32600,
					message: REFUSED.message,
					data: { code: 'INPUT_TOO_LARGE', suggestion: 'Send less', details: { limit: 65_536 } },
				},
			},
		]);
		expect(admit).toHaveBeenCalledTimes(2);
		// A small one is admitted and dispatched.
		send({ jsonrpc: '2.0', id: 8, method: 'ping' });
		await new Promise((resolve) => setTimeout(resolve));
		expect(onRequest).toHaveBeenCalledWith('ping', undefined);
	});

	it('fails the waiting request a refused reply answers', async () => {
		const { channel, send } = open((message) =>
			(message as { result?: unknown }).result !== undefined ? REFUSED : undefined
		);
		const waiting = channel.request('dev.loam/handler-call', {});
		send({ jsonrpc: '2.0', id: 1, result: { big: true } });
		await expect(waiting).rejects.toBeInstanceOf(ChannelError);
		await expect(waiting).rejects.toMatchObject({ code: -32600 });
	});

	it("keeps a refusal's details across the frame, without its JSON-RPC code (9)", () => {
		expect(
			rpcErrorOf({
				code: 'QUOTA_EXCEEDED',
				message: 'Over',
				suggestion: 'Delete some',
				details: { rpcCode: -32600, kind: 'store', limit: 1, used: 1 },
			})
		).toEqual({
			code: -32600,
			message: 'Over',
			data: {
				code: 'QUOTA_EXCEEDED',
				suggestion: 'Delete some',
				details: { kind: 'store', limit: 1, used: 1 },
			},
		});
	});
});

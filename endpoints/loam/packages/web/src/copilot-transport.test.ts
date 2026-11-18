/**
 * The desktop's model transport (phase 5 specification, 4.2): events in any order with `model_send`'s answer, and a
 * stream the page stops reading cancelled at the host however it stopped (step 2's trust review, its improvements 2
 * and 3). A fake window stands in for the main frame, its `invoke` for Tauri's.
 */

import type { CopilotProviderV1 } from '@lushly-dev/loam-kernel/copilot';
import { describe, expect, it } from 'vitest';
import { createDesktopModelTransport, modelEventOf } from './copilot.js';
import { lazyCopilot } from './copilot-lazy.js';

const LOCAL: CopilotProviderV1 = { id: 'local', kind: 'openai-compatible', model: 'm' };

function fakeWindow() {
	const target = new EventTarget();
	const calls: Array<[string, Record<string, unknown>]> = [];
	let next = 0;
	let answer: (value: unknown) => void = () => {};
	let held: Promise<unknown> | undefined;
	const page = Object.assign(target, {
		__TAURI_INTERNALS__: {
			invoke(command: string, args: Record<string, unknown>) {
				calls.push([command, args]);
				if (command === 'model_send') {
					held = new Promise((resolve) => {
						answer = resolve;
					});
					return held;
				}
				return Promise.resolve(null);
			},
		},
	});
	return {
		page: page as unknown as Window,
		calls,
		/** Answer the pending `model_send` with the next stream id. */
		answer() {
			next += 1;
			answer(next);
			return next;
		},
		emit(detail: unknown) {
			target.dispatchEvent(new CustomEvent('loam:model', { detail }));
		},
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const cancels = (calls: Array<[string, Record<string, unknown>]>) =>
	calls.filter(([command]) => command === 'model_cancel').map(([, args]) => args.stream);

describe('the desktop model transport (4.2)', () => {
	it('reads events that arrive before model_send answers, and cancels nothing when read to the end', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const controller = new AbortController();
		const sent = transport.send(LOCAL, {}, controller.signal);
		await tick();
		// The host dispatched before `invoke` answered.
		fake.emit({ stream: 1, status: 200 });
		fake.emit({ stream: 1, chunk: 'Hi' });
		fake.answer();
		const response = await sent;
		expect(response.status).toBe(200);
		fake.emit({ stream: 1, chunk: ' there' });
		fake.emit({ stream: 1, done: true, status: 200 });
		const text: string[] = [];
		for await (const chunk of response.body) text.push(new TextDecoder().decode(chunk));
		expect(text.join('')).toBe('Hi there');
		expect(cancels(fake.calls)).toEqual([]);
	});

	it('cancels a stream whose stop came while model_send was answering', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const controller = new AbortController();
		const sent = transport.send(LOCAL, {}, controller.signal);
		await tick();
		controller.abort();
		const stream = fake.answer();
		await expect(sent).rejects.toMatchObject({ code: 'MODEL_UNREACHABLE' });
		await tick();
		expect(cancels(fake.calls)).toEqual([stream]);
	});

	it('cancels a stream left before its end, and holds none of its later events', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const sent = transport.send(LOCAL, {}, new AbortController().signal);
		await tick();
		const stream = fake.answer();
		fake.emit({ stream, status: 200 });
		const response = await sent;
		fake.emit({ stream, chunk: 'a' });
		for await (const _chunk of response.body) break;
		await tick();
		expect(cancels(fake.calls)).toEqual([stream]);
		// Events still queued behind the cancel: dropped, so they never fill the early buffer.
		for (let index = 0; index < 300; index += 1) fake.emit({ stream, chunk: 'late' });
		const next = transport.send(LOCAL, {}, new AbortController().signal);
		await tick();
		fake.emit({ stream: stream + 1, status: 200 });
		fake.answer();
		expect((await next).status).toBe(200);
	});

	it('throws the end’s code when the request never reached the provider, and cancels nothing', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const sent = transport.send(LOCAL, {}, new AbortController().signal);
		await tick();
		const stream = fake.answer();
		fake.emit({ stream, done: true, status: 502, code: 'MODEL_UNREACHABLE' });
		await expect(sent).rejects.toMatchObject({ code: 'MODEL_UNREACHABLE' });
		await tick();
		expect(cancels(fake.calls)).toEqual([]);
	});

	it('reads exactly the three shapes of an event, and drops anything else', () => {
		expect(modelEventOf({ stream: 1, status: 200 })).toEqual({ stream: 1, status: 200 });
		expect(modelEventOf({ stream: 1, chunk: 'x' })).toEqual({ stream: 1, chunk: 'x' });
		expect(modelEventOf({ stream: 1, done: true, status: 401, code: 'MODEL_REFUSED' })).toEqual({
			stream: 1,
			done: true,
			status: 401,
			code: 'MODEL_REFUSED',
		});
		for (const detail of [
			null,
			{ stream: '1', status: 200 },
			{ stream: 1, chunk: 'x', status: 200 },
			{ stream: 1, done: true, status: 200, code: 'not a code' },
			{ stream: 1, status: 200, extra: true },
			{ stream: 1, chunk: 3 },
		])
			expect(modelEventOf(detail), JSON.stringify(detail)).toBeUndefined();
	});

	it('the lazy copilot loads nothing until a turn, and holds the panel’s run id before its chunk loads', async () => {
		let loads = 0;
		const started: string[] = [];
		const lazy = lazyCopilot({ default: 'local', providers: [LOCAL] }, async () => {
			loads += 1;
			return {
				start: (run: { runId: string }) => started.push(run.runId),
				reset() {},
				subscribe: () => () => {},
				expectRun() {},
				takeRunId: () => undefined,
			} as never;
		});
		expect(lazy.options.providers).toEqual([LOCAL]);
		lazy.panel.expectRun('cps_1', 'rid_1');
		expect(loads).toBe(0);
		expect(lazy.options.takeRunId?.('cps_1')).toBe('rid_1');
		expect(lazy.options.takeRunId?.('cps_1')).toBeUndefined();
		lazy.options.runner?.start({ runId: 'rid_1' } as never);
		await tick();
		expect([loads, started]).toEqual([1, ['rid_1']]);
	});
});

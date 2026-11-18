/**
 * The desktop's model transport (phase 5 specification, 4.2): the page names the stream and listens before it asks,
 * so it hears every event of it, the first included, whenever `model_send` answers; and a stream the page stops
 * reading is cancelled at the host however it stopped (step 2's two trust reviews). A fake window stands in for the
 * main frame, its `invoke` for Tauri's. And the lazy copilot, which loads nothing until a turn.
 */

import type { CopilotProviderV1 } from '@lushly-dev/loam-kernel/copilot';
import { describe, expect, it } from 'vitest';
import { createDesktopModelTransport, modelEventOf } from './copilot.js';
import { lazyCopilot } from './copilot-lazy.js';

const LOCAL: CopilotProviderV1 = { id: 'local', kind: 'openai-compatible', model: 'm' };

function fakeWindow(refuse?: string) {
	const target = new EventTarget();
	const calls: Array<[string, Record<string, unknown>]> = [];
	let answer: () => void = () => {};
	const page = Object.assign(target, {
		__TAURI_INTERNALS__: {
			invoke(command: string, args: Record<string, unknown>) {
				calls.push([command, args]);
				if (command !== 'model_send') return Promise.resolve(null);
				if (refuse) return Promise.reject(refuse);
				return new Promise((resolve) => {
					answer = () => resolve(args.stream);
				});
			},
		},
	});
	return {
		page: page as unknown as Window,
		calls,
		/** The id the page named in its last `model_send`. */
		stream(): number {
			const sent = calls.filter(([command]) => command === 'model_send').at(-1);
			return sent?.[1].stream as number;
		},
		answer: () => answer(),
		emit(detail: unknown) {
			target.dispatchEvent(new CustomEvent('loam:model', { detail }));
		},
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const cancels = (calls: Array<[string, Record<string, unknown>]>) =>
	calls.filter(([command]) => command === 'model_cancel').map(([, args]) => args.stream);

describe('the desktop model transport (4.2)', () => {
	it('names a safe-integer stream and hears all of it, events sent before model_send answered included', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const sent = transport.send(LOCAL, {}, new AbortController().signal);
		await tick();
		const stream = fake.stream();
		expect(Number.isSafeInteger(stream) && stream > 0).toBe(true);
		// More events than step 2's first version held before an answer, and its end, all before `invoke` answers.
		fake.emit({ stream, status: 200 });
		for (let index = 0; index < 400; index += 1) fake.emit({ stream, chunk: 'a' });
		fake.emit({ stream: stream + 1, chunk: 'another stream' });
		fake.emit({ stream, done: true, status: 200 });
		fake.answer();
		const response = await sent;
		expect(response.status).toBe(200);
		let text = '';
		for await (const chunk of response.body) text += new TextDecoder().decode(chunk);
		expect(text).toBe('a'.repeat(400));
		expect(cancels(fake.calls)).toEqual([]);
	});

	it('cancels a stream whose stop came while model_send was answering', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const controller = new AbortController();
		const sent = transport.send(LOCAL, {}, controller.signal);
		await tick();
		controller.abort();
		fake.answer();
		await expect(sent).rejects.toMatchObject({ code: 'MODEL_UNREACHABLE' });
		await tick();
		expect(cancels(fake.calls)).toEqual([fake.stream()]);
	});

	it('cancels a stream left before its end', async () => {
		const fake = fakeWindow();
		const transport = createDesktopModelTransport(fake.page);
		const sent = transport.send(LOCAL, {}, new AbortController().signal);
		await tick();
		const stream = fake.stream();
		fake.emit({ stream, status: 200 });
		fake.answer();
		const response = await sent;
		fake.emit({ stream, chunk: 'a' });
		for await (const _chunk of response.body) break;
		await tick();
		expect(cancels(fake.calls)).toEqual([stream]);
	});

	it('throws the host’s code, and cancels nothing, when the request was refused or never reached the provider', async () => {
		const refused = fakeWindow('COPILOT_KEY_MISSING');
		await expect(
			createDesktopModelTransport(refused.page).send(LOCAL, {}, new AbortController().signal)
		).rejects.toMatchObject({ code: 'COPILOT_KEY_MISSING' });
		const fake = fakeWindow();
		const sent = createDesktopModelTransport(fake.page).send(
			LOCAL,
			{},
			new AbortController().signal
		);
		await tick();
		fake.emit({ stream: fake.stream(), done: true, status: 502, code: 'MODEL_UNREACHABLE' });
		fake.answer();
		await expect(sent).rejects.toMatchObject({ code: 'MODEL_UNREACHABLE' });
		await tick();
		expect(cancels([...refused.calls, ...fake.calls])).toEqual([]);
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
});

describe('the lazy copilot', () => {
	const host = (started: string[], loads: { count: number }) => async () => {
		loads.count += 1;
		return {
			start: (run: { runId: string }) => started.push(run.runId),
			reset() {},
			subscribe: () => () => {},
			expectRun() {},
			takeRunId: () => undefined,
		} as never;
	};

	it('loads nothing until a turn, and holds the panel’s run id before its chunk loads', async () => {
		const loads = { count: 0 };
		const started: string[] = [];
		const lazy = lazyCopilot({ default: 'local', providers: [LOCAL] }, host(started, loads));
		expect(lazy.options.providers).toEqual([LOCAL]);
		lazy.panel.expectRun('cps_1', 'rid_1');
		expect(loads.count).toBe(0);
		expect(lazy.options.takeRunId?.('cps_1')).toBe('rid_1');
		expect(lazy.options.takeRunId?.('cps_1')).toBeUndefined();
		lazy.options.runner?.start({ runId: 'rid_1', signal: new AbortController().signal } as never);
		await tick();
		expect([loads.count, started]).toEqual([1, ['rid_1']]);
	});

	it('starts no run that was stopped while its chunk loaded', async () => {
		const loads = { count: 0 };
		const started: string[] = [];
		const lazy = lazyCopilot({ default: 'local', providers: [LOCAL] }, host(started, loads));
		const controller = new AbortController();
		lazy.options.runner?.start({ runId: 'rid_2', signal: controller.signal } as never);
		controller.abort();
		await tick();
		expect([loads.count, started]).toEqual([1, []]);
	});
});

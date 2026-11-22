/**
 * #1508's first item (phase 5 specification, 3.2, 3.4): the frame's bootstrap starts a worker for each session's ports,
 * never one per runtime chunk, so a compromised runtime holds one session's ports alone; and a worker serves the first
 * port set it is given and no other. Run over stand-ins for the frame's globals; the real frame is P5-A2's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeWorker {
	url: string;
	posted: Array<{ message: unknown; ports: unknown[] }>;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

async function bootstrap() {
	const workers: FakeWorker[] = [];
	let listener: ((event: { source: unknown; data: unknown; ports: unknown[] }) => void) | undefined;
	const parent = {};
	vi.stubGlobal('window', {
		parent,
		addEventListener: (_type: string, handler: typeof listener) => {
			listener = handler;
		},
	});
	vi.stubGlobal('document', {
		currentScript: { src: 'loam-sandbox://localhost/sandbox/copilot/bootstrap.js' },
	});
	vi.stubGlobal('location', { href: 'loam-sandbox://localhost/sandbox/copilot/index.html' });
	vi.stubGlobal(
		'Worker',
		class {
			readonly record: FakeWorker;
			constructor(url: string) {
				this.record = { url, posted: [] };
				workers.push(this.record);
			}
			postMessage(message: unknown, ports: unknown[]) {
				this.record.posted.push({ message, ports });
			}
		}
	);
	let blobs = 0;
	vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${++blobs}` }));
	await import('./bootstrap.js');
	const post = (kind: string, ports: unknown[], source: unknown = parent) =>
		listener?.({ source, data: { kind }, ports });
	return { workers, post };
}

describe('#1508: a worker per session', () => {
	it('starts a worker for each session’s ports, of one provider kind or two, and hands each its own', async () => {
		const { workers, post } = await bootstrap();
		post('anthropic', ['a1', 'a2', 'a3']);
		post('test', ['b1', 'b2', 'b3']);
		post('openai', ['c1', 'c2', 'c3']);
		expect(workers).toHaveLength(3);
		expect(workers.map((worker) => worker.posted.map((each) => each.ports))).toEqual([
			[['a1', 'a2', 'a3']],
			[['b1', 'b2', 'b3']],
			[['c1', 'c2', 'c3']],
		]);
		// One blob URL per chunk: two sessions of the same chunk share the script, never the worker.
		expect(workers[0]?.url).toBe(workers[1]?.url);
		// A message from anyone but the parent, or with other than three ports, starts nothing.
		post('anthropic', ['x', 'y', 'z'], {});
		post('anthropic', ['x', 'y']);
		post('nope', ['x', 'y', 'z']);
		expect(workers).toHaveLength(3);
	});
});

describe('#1508: a worker serves one session', () => {
	it('serves the first port set it is given, and ignores every later one', async () => {
		const served: unknown[] = [];
		vi.doMock('./../serve.js', () => ({
			serveRuntime: (ports: unknown) => served.push(ports),
		}));
		let listener: ((event: { ports: unknown[] }) => void) | undefined;
		vi.stubGlobal('self', {
			addEventListener: (_type: string, handler: typeof listener) => {
				listener = handler;
			},
		});
		const { serveWorker } = await import('../worker.js');
		serveWorker(() => ({}) as never);
		listener?.({ ports: ['a1', 'a2', 'a3'] });
		listener?.({ ports: ['b1', 'b2', 'b3'] });
		expect(served).toEqual([{ agent: 'a1', model: 'a2', panel: 'a3' }]);
	});
});

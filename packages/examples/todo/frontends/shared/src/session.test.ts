/**
 * @fileoverview The shared session against a real TypeScript backend over Streamable HTTP: the
 * built server (`backends/typescript/dist/server.js`) with an in-memory store, on a free port.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type SessionState, TodoSession } from './session.ts';

const SERVER = fileURLToPath(
	new URL('../../../backends/typescript/dist/server.js', import.meta.url)
);

let backend: ChildProcess;
let baseUrl: string;
const sessions: TodoSession[] = [];
const extra: ChildProcess[] = [];

/** Start a backend on this port and wait until it answers. */
async function startBackend(port: number): Promise<ChildProcess> {
	const child = spawn(process.execPath, [SERVER], {
		env: {
			...process.env,
			TRANSPORT: 'http',
			HOST: '127.0.0.1',
			PORT: String(port),
			TODO_STORE_TYPE: 'memory',
		},
		stdio: 'ignore',
	});
	const healthUrl = `http://127.0.0.1:${port}/health`;
	for (let attempt = 0; attempt < 80; attempt++) {
		if (child.exitCode !== null || child.signalCode !== null) {
			throw new Error(
				`The backend exited before ready (code=${child.exitCode}, signal=${child.signalCode})`
			);
		}
		try {
			if ((await fetch(healthUrl)).ok) return child;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 125));
	}
	child.kill();
	throw new Error(`The backend did not answer ${healthUrl}`);
}

async function stopBackend(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise((resolve) => child.once('exit', resolve));
	child.kill();
	await exited;
}

/**
 * A fetch that holds the answer to the next request whose body names `command` until `release()`:
 * the server has answered, but the page reads it late, as over a slow network.
 */
function holdingFetch() {
	let hold: { command: string; released: Promise<void> } | undefined;
	let release = () => {};
	let reached = () => {};
	const fetchWithHold: typeof fetch = async (input, init) => {
		const body = typeof init?.body === 'string' ? init.body : '';
		const waiting = hold;
		const matched = waiting !== undefined && body.includes(`"name":"${waiting.command}"`);
		if (matched) hold = undefined;
		const response = await fetch(input, init);
		if (!matched || !waiting) return response;
		const text = await response.text();
		reached();
		await waiting.released;
		return new Response(text, { status: response.status, headers: response.headers });
	};
	return {
		fetch: fetchWithHold,
		/** Hold the next answer naming `command`; resolves once the server has answered it. */
		holdNext(command: string): Promise<void> {
			hold = { command, released: new Promise<void>((resolve) => (release = resolve)) };
			return new Promise<void>((resolve) => (reached = resolve));
		},
		release: () => release(),
	};
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

beforeAll(async () => {
	const port = await freePort();
	baseUrl = `http://127.0.0.1:${port}`;
	backend = await startBackend(port);
}, 30_000);

afterAll(async () => {
	backend?.kill();
	for (const child of extra.splice(0)) await stopBackend(child);
});

afterEach(() => {
	for (const session of sessions.splice(0)) session.stop();
});

async function open(url = baseUrl): Promise<TodoSession> {
	const session = new TodoSession({ baseUrl: url, pollMs: 0 });
	sessions.push(session);
	await session.start();
	return session;
}

/** Resolves with the first state that matches. */
function until(
	session: TodoSession,
	matches: (state: SessionState) => boolean
): Promise<SessionState> {
	return new Promise((resolve) => {
		const stop = session.subscribe((state) => {
			if (matches(state)) {
				queueMicrotask(() => stop());
				resolve(state);
			}
		});
	});
}

/** The id of the shown todo with this title; fails the test when it is not shown. */
function idOf(session: TodoSession, title: string): string {
	const todo = session.snapshot.todos.find((each) => each.title === title);
	if (!todo) throw new Error(`"${title}" is not in the list`);
	return todo.id;
}

/** A title no other test uses, so tests sharing the backend do not see each other's todos. */
let counter = 0;
const unique = (title: string) => `${title} ${Date.now()}-${++counter}`;

describe('TodoSession', () => {
	it('adds, completes and undoes the completion', async () => {
		const session = await open();
		const title = unique('Water the seedlings');
		await session.add(title, 'high');
		const id = idOf(session, title);
		await session.toggle(id);
		expect(session.snapshot.undo?.command).toBe('todo-update');
		expect(session.snapshot.trust).toMatchObject({ command: 'todo-toggle', success: true });
		await session.undo();
		const after = session.snapshot.todos.find((each) => each.id === id);
		expect(after?.completed).toBe(false);
	});

	it('deletes and brings a todo back, and shows the deleted list', async () => {
		const session = await open();
		const title = unique('Book the rotavator');
		await session.add(title);
		const id = idOf(session, title);
		await session.remove(id);
		expect(session.snapshot.undo?.command).toBe('todo-restore');
		session.show('deleted');
		const deleted = await until(session, (state) => state.todos.some((each) => each.id === id));
		expect(deleted.todos.find((each) => each.id === id)?.deletedAt).toBeDefined();
		session.show('live');
		await session.undo();
		expect(session.snapshot.todos.some((each) => each.id === id)).toBe(true);
	});

	it('asks the person before a clear, and clears once they approve', async () => {
		const session = await open();
		const title = unique('Lift the leeks');
		await session.add(title);
		await session.toggle(idOf(session, title));
		const clearing = session.clearCompleted();
		const asked = await until(session, (state) => state.approval !== undefined);
		expect(asked.approval).toMatchObject({ kind: 'approval' });
		expect(asked.approval?.message).toContain('Remove the completed todos for good');
		session.approve();
		const result = await clearing;
		expect(result.success).toBe(true);
		expect(session.snapshot.todos.some((each) => each.title === title)).toBe(false);
	});

	it('keeps everything when the person declines, and says why', async () => {
		const session = await open();
		const title = unique('Keep the beans');
		await session.add(title);
		await session.toggle(idOf(session, title));
		const clearing = session.clearCompleted();
		await until(session, (state) => state.approval !== undefined);
		session.deny();
		const result = await clearing;
		expect(result.error?.code).toBe('APPROVAL_REQUIRED');
		expect(session.snapshot.error?.suggestion).toBeDefined();
		session.setFilter({ status: 'completed' });
		const shown = await until(
			session,
			(state) => state.filter.status === 'completed' && state.todos.length > 0
		);
		expect(shown.todos.some((each) => each.title === title)).toBe(true);
	});

	it('notices a change another client made', async () => {
		const mine = await open();
		const theirs = await open();
		const title = unique('Turn the compost');
		await theirs.add(title);
		await mine.poll();
		expect(mine.snapshot.remote).toMatch(/1 change by agent from another client/);
		expect(mine.snapshot.todos.some((each) => each.title === title)).toBe(true);
	});

	it('logs the commands it ran, newest first, without its background polling', async () => {
		const session = await open();
		await session.add(unique('Logged'));
		await session.poll();
		const commands = session.snapshot.log.map((entry) => entry.command);
		expect(commands).toContain('todo-create');
		expect(session.snapshot.log[0]?.result).toBeDefined();
		expect(
			session.snapshot.log.filter((entry) => entry.command === 'todo-history').length
		).toBeLessThanOrEqual(2);
	});

	it("keeps a failed command's error, and reconnects on one retry once the backend is back", async () => {
		const port = await freePort();
		let child = await startBackend(port);
		extra.push(child);
		const session = await open(`http://127.0.0.1:${port}`);
		await stopBackend(child);
		const title = unique('Order seed potatoes');
		await session.add(title);
		expect(session.snapshot.error).toMatchObject({
			command: 'todo-create',
			code: 'BACKEND_UNREACHABLE',
		});
		expect(session.snapshot.connected).toBe(false);
		child = await startBackend(port);
		extra.push(child);
		await session.retry();
		expect(session.snapshot.error).toBeUndefined();
		expect(session.snapshot.connected).toBe(true);
		expect(session.snapshot.todos.some((each) => each.title === title)).toBe(true);
	}, 30_000);

	it('shares one reconnect among calls made at once', async () => {
		const port = await freePort();
		let child = await startBackend(port);
		extra.push(child);
		const session = await open(`http://127.0.0.1:${port}`);
		await stopBackend(child);
		await session.refresh();
		child = await startBackend(port);
		extra.push(child);
		const results = await Promise.all([
			session.client.call('todo-list'),
			session.client.call('todo-stats'),
			session.client.call('todo-history'),
		]);
		expect(results.map((result) => result.success)).toEqual([true, true, true]);
	}, 30_000);

	it('never lets an older refresh that answers late undo a newer state', async () => {
		const control = holdingFetch();
		const session = new TodoSession({ baseUrl, pollMs: 0, fetch: control.fetch });
		sessions.push(session);
		await session.start();
		const a = unique('First');
		const b = unique('Second');
		await session.add(a);
		await session.add(b);
		// The refresh after toggling A answers late, after B is toggled and read
		const held = control.holdNext('todo-list');
		const first = session.toggle(idOf(session, a));
		await held;
		await session.toggle(idOf(session, b));
		control.release();
		await first;
		const shown = session.snapshot.todos;
		expect(shown.find((todo) => todo.title === a)?.completed).toBe(true);
		expect(shown.find((todo) => todo.title === b)?.completed).toBe(true);
	});

	it("does not report its own change in flight as another client's", async () => {
		const control = holdingFetch();
		const session = new TodoSession({ baseUrl, pollMs: 0, fetch: control.fetch });
		sessions.push(session);
		await session.start();
		const held = control.holdNext('todo-list');
		const adding = session.add(unique('Mine'));
		await held;
		await session.poll();
		control.release();
		await adding;
		await session.poll();
		expect(session.snapshot.remote).toBeUndefined();
	});

	it('says how to recover when no backend answers', async () => {
		const port = await freePort();
		const session = new TodoSession({ baseUrl: `http://127.0.0.1:${port}`, pollMs: 0 });
		sessions.push(session);
		await session.start();
		expect(session.snapshot.connected).toBe(false);
		expect(session.snapshot.error).toMatchObject({ code: 'BACKEND_UNREACHABLE' });
		expect(session.snapshot.error?.suggestion).toContain('pnpm dev:ts');
		expect(session.snapshot.error?.retry).toBeDefined();
	});
});

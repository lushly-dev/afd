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
	backend = spawn(process.execPath, [SERVER], {
		env: {
			...process.env,
			TRANSPORT: 'http',
			HOST: '127.0.0.1',
			PORT: String(port),
			TODO_STORE_TYPE: 'memory',
		},
		stdio: 'ignore',
	});
	for (let attempt = 0; attempt < 80; attempt++) {
		try {
			if ((await fetch(`${baseUrl}/health`)).ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 125));
	}
	throw new Error('The backend did not start');
}, 30_000);

afterAll(() => {
	backend?.kill();
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

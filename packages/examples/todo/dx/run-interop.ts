/**
 * The TypeScript and Python backends share one SQLite database (the to-do reference plan's D4).
 *
 * Starts both servers over stdio on the same new database file, at once, and changes the todos
 * through each in turn: each server must read exactly what the other wrote, the live and deleted
 * todos and the change history, in the same order. Run from `packages/examples/todo` with
 * `pnpm test:interop`, which builds the TypeScript backend first; the Python one runs under `uv`.
 */

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Result = {
	success: boolean;
	data?: unknown;
	error?: { code: string; message: string };
	alternatives?: Array<{ data: unknown; reason: string }>;
};

interface Backend {
	name: string;
	call(tool: string, args?: Record<string, unknown>): Promise<Result>;
	/** The data of a call that must succeed. */
	data<T = Record<string, unknown>>(tool: string, args?: Record<string, unknown>): Promise<T>;
	close(): Promise<void>;
	stderr(): string;
}

async function start(
	name: string,
	command: string,
	args: string[],
	env: Record<string, string>
): Promise<Backend> {
	const transport = new StdioClientTransport({ command, args, env, stderr: 'pipe' });
	let log = '';
	transport.stderr?.on('data', (chunk) => {
		log += String(chunk);
	});
	const client = new Client({ name: `interop-${name}`, version: '1.0.0' }, { capabilities: {} });
	await client.connect(transport);
	const call = async (tool: string, input: Record<string, unknown> = {}): Promise<Result> => {
		const result = (await client.callTool({ name: tool, arguments: input })) as {
			content: Array<{ text: string }>;
		};
		return JSON.parse(result.content[0]?.text ?? '{}') as Result;
	};
	return {
		name,
		call,
		async data<T>(tool: string, input: Record<string, unknown> = {}) {
			const result = await call(tool, input);
			if (!result.success) {
				throw new Error(`${name} ${tool} failed: ${JSON.stringify(result.error)}`);
			}
			return result.data as T;
		},
		close: () => client.close(),
		stderr: () => log,
	};
}

type Todo = { id: string; title: string; completed: boolean; deletedAt?: string };
type List = { todos: Todo[]; total: number };
type History = { entries: Array<{ seq: number; command: string; actor: { kind: string } }> };

let checks = 0;
function check(what: string, assertion: () => void): void {
	assertion();
	checks++;
	console.log(`✅ ${what}`);
}

/** Both backends answer the read `tool` with the same data and the same alternatives. */
async function same(ts: Backend, py: Backend, tool: string, args: Record<string, unknown> = {}) {
	const answer = async (backend: Backend) => {
		const result = await backend.call(tool, args);
		if (!result.success) {
			throw new Error(`${backend.name} ${tool} failed: ${JSON.stringify(result.error)}`);
		}
		return { data: result.data, alternatives: result.alternatives };
	};
	const [fromTs, fromPy] = [await answer(ts), await answer(py)];
	deepStrictEqual(fromPy, fromTs, `${tool} ${JSON.stringify(args)} differs between the backends`);
	return fromTs.data;
}

async function run(): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'todo-interop-'));
	const env = {
		...(process.env as Record<string, string>),
		TODO_STORE_TYPE: 'sqlite',
		TODO_STORE_PATH: path.join(dir, 'todos.db'),
		// The clear runs here; the approval hold has its own suite.
		APPROVALS: 'off',
	};
	const started: Backend[] = [];
	try {
		const ts = await start(
			'TypeScript',
			'node',
			[path.join(__dirname, '../backends/typescript/dist/server.js')],
			{ ...env, PORT: '3102' }
		);
		started.push(ts);
		const py = await start(
			'Python',
			'uv',
			['run', '--project', path.join(__dirname, '../backends/python'), 'todo-server'],
			env
		);
		started.push(py);

		// TypeScript writes; Python reads
		const first = await ts.data<Todo>('todo-create', {
			title: 'Written by TypeScript',
			description: 'Read by Python',
			priority: 'high',
		});
		const second = await ts.data<Todo>('todo-create', { title: 'Deleted by Python' });
		const readByPy = await py.data('todo-get', { id: first.id });
		check('Python reads a todo TypeScript wrote, field for field', () =>
			deepStrictEqual(readByPy, first)
		);
		// `same` compares the whole answers, so the order (ties included) matches too
		const listed = await same(ts, py, 'todo-list', {});
		check('Both list the same todos in the same order', () =>
			deepStrictEqual(
				(listed as List).todos.map((todo) => todo.id).sort(),
				[first.id, second.id].sort()
			)
		);

		// Python writes; TypeScript reads
		await py.data('todo-toggle', { id: first.id });
		await py.data('todo-delete', { id: second.id });
		const third = await py.data<Todo>('todo-create', {
			title: 'Written by Python',
			priority: 'low',
		});
		const readByTs = await ts.data('todo-get', { id: third.id });
		check('TypeScript reads a todo Python wrote, field for field', () =>
			deepStrictEqual(readByTs, third)
		);
		const toggled = await ts.data<Todo>('todo-get', { id: first.id });
		check('TypeScript sees the completion Python made', () => strictEqual(toggled.completed, true));
		const deleted = (await same(ts, py, 'todo-list', { deleted: true })) as List;
		check('TypeScript finds the todo Python deleted among the deleted ones', () => {
			deepStrictEqual(
				deleted.todos.map((todo) => todo.id),
				[second.id]
			);
			strictEqual(typeof deleted.todos[0]?.deletedAt, 'string');
		});
		const missing = await ts.call('todo-get', { id: second.id });
		check('TypeScript does not show it as live', () => strictEqual(missing.success, false));

		// TypeScript restores what Python deleted
		await ts.data('todo-restore', { ids: [second.id] });
		const restored = await py.data<Todo>('todo-get', { id: second.id });
		check('Python reads the todo TypeScript restored, without deletedAt', () =>
			strictEqual(restored.deletedAt, undefined)
		);
		await same(ts, py, 'todo-list', { sortBy: 'title', sortOrder: 'asc' });
		const filtered = (await same(ts, py, 'todo-list', { completed: false })) as List;
		check('Both filter the same way, with the same alternatives', () =>
			strictEqual(filtered.total, 2)
		);
		await same(ts, py, 'todo-list', { priority: 'high', search: 'typescript' });
		await same(ts, py, 'todo-stats');

		// One history, written by both
		const history = (await same(ts, py, 'todo-history', { limit: 100 })) as History;
		check('Both read one history, in order, with the actor of each change', () => {
			deepStrictEqual(
				history.entries.map((entry) => [entry.seq, entry.command, entry.actor.kind]),
				[
					[6, 'todo-restore', 'agent'],
					[5, 'todo-create', 'agent'],
					[4, 'todo-delete', 'agent'],
					[3, 'todo-toggle', 'agent'],
					[2, 'todo-create', 'agent'],
					[1, 'todo-create', 'agent'],
				]
			);
		});

		// Clears cross over too
		await ts.data('todo-delete', { id: third.id });
		const emptied = await py.data<{ cleared: number }>('todo-clear', { deleted: true });
		check('Python empties the todo TypeScript deleted', () => strictEqual(emptied.cleared, 1));
		const cleared = await py.data<{ cleared: number }>('todo-clear', { all: true });
		const left = await ts.data<List>('todo-list', {});
		check('TypeScript sees the clear Python made', () => {
			strictEqual(cleared.cleared, 2);
			strictEqual(left.total, 0);
		});
		await same(ts, py, 'todo-history', { limit: 100 });

		console.log(`\nSummary: ${checks} checks passed; both backends share one database`);
	} catch (error) {
		for (const backend of started) {
			console.error(`--- ${backend.name} stderr ---\n${backend.stderr().slice(-4000)}`);
		}
		throw error;
	} finally {
		for (const backend of started) await backend.close();
		await rm(dir, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});

/**
 * The TypeScript and Python backends share one SQLite database (the to-do reference plan's D4).
 *
 * 1. **Changes cross over.** The TypeScript server creates a new database; the Python server
 *    opens it while the TypeScript one still runs, and the todos are changed through each in
 *    turn: each must read exactly what the other wrote (live and deleted todos, the history) and
 *    answer every read alike, order and alternatives included, titles with accents and case
 *    among them. Both describe every command alike (`afd-detail`).
 * 2. **Python creates the file.** Python's store creates and seeds a new database; the
 *    TypeScript server opens it and lists the seed.
 * 3. **TypeScript creates the file.** TypeScript's `SqliteStore.check()` creates and seeds a new
 *    database; the Python server opens it and lists the seed.
 * 4. **Both create it at once.** A Python process and the TypeScript store open one new database
 *    at the same moment, several times: the seed is written once, never twice or not at all.
 *
 * Run from `packages/examples/todo` with `pnpm test:interop`, which builds the TypeScript backend
 * first; the Python one runs under `uv`.
 */

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '../backends/python');
const TS_SERVER = path.join(__dirname, '../backends/typescript/dist/server.js');
const TS_STORE = path.join(__dirname, '../backends/typescript/dist/store/index.js');
const SEED_PATH = path.join(__dirname, '../data/todos.seed.json');
const SPEC_PATH = path.join(__dirname, '../spec/commands.schema.json');

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

/** The TypeScript store, loaded from the build so this file typechecks without it. */
interface TsSqliteStore {
	check(): Promise<void>;
	close(): void;
}
type TsStoreModule = {
	SqliteStore: new (path: string, options?: { seedPath?: string }) => TsSqliteStore;
};

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

/** The environment of a server on the database at `file`. */
function envFor(file: string): Record<string, string> {
	return {
		...(process.env as Record<string, string>),
		TODO_STORE_TYPE: 'sqlite',
		TODO_STORE_PATH: file,
		// The clears run here; the approval hold has its own suite.
		APPROVALS: 'off',
	};
}

const startTs = (file: string) =>
	start('TypeScript', 'node', [TS_SERVER], { ...envFor(file), PORT: '3102' });
const startPy = (file: string) =>
	start('Python', 'uv', ['run', '--project', PYTHON, 'todo-server'], envFor(file));

/**
 * A Python process that opens `file` as a seeded store once this script says go, so the
 * TypeScript store can open it at the same moment. It prints `ready` after its imports.
 */
const PYTHON_OPEN = `
import sys
from todo_backend import SqliteStore
print("ready", flush=True)
sys.stdin.readline()
SqliteStore(sys.argv[1], seed_path=sys.argv[2]).close()
print("done", flush=True)
`;

function spawnPythonOpen(file: string): {
	child: ChildProcess;
	ready: Promise<void>;
	done: Promise<void>;
} {
	const child = spawn(
		'uv',
		['run', '--project', PYTHON, 'python', '-c', PYTHON_OPEN, file, SEED_PATH],
		{
			stdio: ['pipe', 'pipe', 'inherit'],
		}
	);
	let output = '';
	const seen = (word: string) =>
		new Promise<void>((resolve, reject) => {
			const look = () => {
				if (output.includes(word)) resolve();
			};
			child.stdout?.on('data', (chunk) => {
				output += String(chunk);
				look();
			});
			child.once('exit', (code) =>
				output.includes(word)
					? resolve()
					: reject(new Error(`Python exited with ${code}: ${output}`))
			);
		});
	return { child, ready: seen('ready'), done: seen('done') };
}

type Todo = { id: string; title: string; completed: boolean; deletedAt?: string };
type List = { todos: Todo[]; total: number };
type History = { entries: Array<{ seq: number; command: string; actor: { kind: string } }> };

const SEED = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Todo[];

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

/** The commands both languages implement, from the spec. */
function sharedCommands(): string[] {
	const commands = JSON.parse(readFileSync(SPEC_PATH, 'utf-8')).commands as Record<
		string,
		{ implementedBy?: string[] }
	>;
	return Object.entries(commands)
		.filter(([, entry]) => (entry.implementedBy ?? ['python']).includes('python'))
		.map(([name]) => name);
}

/** Run `body` with servers that are closed afterwards, printing their stderr on a failure. */
async function withServers(
	open: Array<() => Promise<Backend>>,
	body: (backends: Backend[]) => Promise<void>
): Promise<void> {
	const started: Backend[] = [];
	try {
		for (const each of open) started.push(await each());
		await body(started);
	} catch (error) {
		for (const backend of started) {
			console.error(`--- ${backend.name} stderr ---\n${backend.stderr().slice(-4000)}`);
		}
		throw error;
	} finally {
		for (const backend of started) await backend.close();
	}
}

/** 1. The TypeScript server creates the file; changes made through each are read by the other. */
async function changesCrossOver(file: string): Promise<void> {
	await withServers([() => startTs(file), () => startPy(file)], async ([ts, py]) => {
		if (!ts || !py) throw new Error('Both servers must start');

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
		const listed = (await same(ts, py, 'todo-list', {})) as List;
		check('Both list the same todos in the same order', () =>
			deepStrictEqual(listed.todos.map((todo) => todo.id).sort(), [first.id, second.id].sort())
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

		// Titles in one collation: base letters, then accents, then case, lowercase first
		for (const [index, title] of ['Apple', 'apple', 'Zebra', 'Äpfel', 'banana'].entries()) {
			await (index % 2 === 0 ? ts : py).data('todo-create', { title });
		}
		const ascending = (await same(ts, py, 'todo-list', {
			sortBy: 'title',
			sortOrder: 'asc',
		})) as List;
		await same(ts, py, 'todo-list', { sortBy: 'title', sortOrder: 'desc' });
		check('Both sort titles alike: Äpfel, apple, Apple, banana, Zebra', () =>
			deepStrictEqual(
				ascending.todos.map((todo) => todo.title),
				['Äpfel', 'apple', 'Apple', 'banana', 'Zebra']
			)
		);

		// Every command described alike
		const fields = ['name', 'title', 'description', 'category', 'tags', 'mutation'] as const;
		const detail = async (backend: Backend, command: string) => {
			const [found] = await backend.data<Array<Record<string, unknown>>>('afd-detail', { command });
			return Object.fromEntries(fields.map((field) => [field, found?.[field]]));
		};
		const commands = sharedCommands();
		for (const command of commands) {
			deepStrictEqual(await detail(py, command), await detail(ts, command), `${command} differs`);
		}
		check(
			`Both describe all ${commands.length} commands alike (title, description, tags)`,
			() => {}
		);
	});
}

/** The todos a server lists, oldest first, which on a seeded database are the seed's. */
async function listed(backend: Backend): Promise<Todo[]> {
	return (await backend.data<List>('todo-list', { sortBy: 'createdAt', sortOrder: 'asc' })).todos;
}

/** 2. Python creates and seeds the file; the TypeScript server reads it. */
async function pythonCreates(file: string): Promise<void> {
	const opener = spawnPythonOpen(file);
	await opener.ready;
	opener.child.stdin?.end('go\n');
	await opener.done;
	await withServers([() => startTs(file)], async ([ts]) => {
		if (!ts) throw new Error('The TypeScript server must start');
		const todos = await listed(ts);
		check('TypeScript opens a database Python created and lists its seed', () =>
			deepStrictEqual(todos, SEED)
		);
	});
}

/** 3. TypeScript's `check()` creates and seeds the file; the Python server reads it. */
async function typescriptCreates(file: string, store: TsStoreModule): Promise<void> {
	const created = new store.SqliteStore(file, { seedPath: SEED_PATH });
	await created.check();
	created.close();
	await withServers([() => startPy(file)], async ([py]) => {
		if (!py) throw new Error('The Python server must start');
		const todos = await listed(py);
		check('Python opens a database TypeScript created and lists its seed', () =>
			deepStrictEqual(todos, SEED)
		);
	});
}

/** 4. Both open one new file at the same moment; the seed is written exactly once. */
async function bothCreate(dir: string, store: TsStoreModule, rounds: number): Promise<void> {
	for (let round = 0; round < rounds; round++) {
		const file = path.join(dir, `race-${round}.db`);
		const opener = spawnPythonOpen(file);
		await opener.ready;
		const ts = new store.SqliteStore(file, { seedPath: SEED_PATH });
		opener.child.stdin?.end('go\n');
		await Promise.all([ts.check(), opener.done]);
		ts.close();
		await withServers([() => startPy(file)], async ([py]) => {
			if (!py) throw new Error('The Python server must start');
			deepStrictEqual(await listed(py), SEED, `round ${round}: the seed was not written once`);
		});
	}
	check(`Opened at once ${rounds} times, the seed is written exactly once`, () => {});
}

async function run(): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'todo-interop-'));
	try {
		const store = (await import(pathToFileURL(TS_STORE).href)) as TsStoreModule;
		await changesCrossOver(path.join(dir, 'todos.db'));
		await pythonCreates(path.join(dir, 'python-created.db'));
		await typescriptCreates(path.join(dir, 'typescript-created.db'), store);
		await bothCreate(dir, store, 5);
		console.log(`\nSummary: ${checks} checks passed; both backends share one database`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});

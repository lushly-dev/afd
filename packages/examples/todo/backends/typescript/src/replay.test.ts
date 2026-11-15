/**
 * @fileoverview Job 7: a recorded session replays to the same results. Records the scenario
 * through the server's journal, then replays the journal against a fresh registry from
 * `registry.ts`, the module `afd replay` loads.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { createMcpServer, replayJournal } from '@lushly-dev/afd-server';
import {
	fixedClock,
	InProcessExecutor,
	parseScenarioFile,
	seededRandom,
} from '@lushly-dev/afd-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import createReplayRegistry from './registry.js';
import { createTodoServerOptions } from './server-options.js';
import { setStore, store, TodoStore } from './store/index.js';

const scenario = fileURLToPath(
	new URL('../scenarios/07-replay-a-session.scenario.yaml', import.meta.url)
);

async function record(journal: MemoryJournalSink): Promise<void> {
	const parsed = await parseScenarioFile(scenario);
	if (!parsed.success) throw new Error(parsed.error);
	const server = createMcpServer(createTodoServerOptions({}, { journal }));
	const executor = new InProcessExecutor({
		handler: (command, input, context) => server.execute(command, input ?? {}, context),
		context: {
			clock: fixedClock('2026-11-15T09:00:00Z'),
			random: seededRandom('todo-reference'),
		},
	});
	const result = await executor.execute(parsed.scenario);
	expect(result.outcome).toBe('pass');
}

beforeEach(() => {
	setStore(new TodoStore());
});

describe('replaying a session (job 7)', () => {
	it('gives the same result for every recorded call', async () => {
		const journal = new MemoryJournalSink();
		await record(journal);
		const entries = await journal.read();
		expect(entries.map((entry) => entry.command)).toEqual([
			'todo-create',
			'todo-update',
			'todo-toggle',
			'todo-delete',
		]);

		const report = await replayJournal(createReplayRegistry(), entries);
		expect(report.entries.filter((entry) => entry.status !== 'same')).toEqual([]);
		expect(report.same).toBe(4);
	});

	it('replays into a fresh store, leaving the recording untouched', async () => {
		const journal = new MemoryJournalSink();
		await record(journal);
		const recorded = store;
		await replayJournal(createReplayRegistry(), await journal.read());
		expect(store).not.toBe(recorded);
		expect(recorded.list({ deleted: true })).toHaveLength(1);
	});

	it('records no held call, so no approval token reaches the journal', async () => {
		const journal = new MemoryJournalSink();
		const server = createMcpServer(createTodoServerOptions({}, { journal }));
		const agent = { actor: { kind: 'agent' as const } };
		const created = await server.execute('todo-create', { title: 'Hold me' }, agent);
		await server.execute('todo-toggle', { id: (created.data as { id: string }).id }, agent);
		const held = await server.execute('todo-clear', {}, agent);
		expect(held.error?.code).toBe('APPROVAL_REQUIRED');
		await server.execute('todo-clear', {}, { actor: { kind: 'human' as const } });

		const entries = await journal.read();
		expect(entries.map((entry) => [entry.command, entry.actor?.kind])).toEqual([
			['todo-create', 'agent'],
			['todo-toggle', 'agent'],
			['todo-clear', 'human'],
		]);
		expect(JSON.stringify(entries)).not.toContain('approvalToken');
	});

	it('replays an agent call that a person approved', async () => {
		const journal = new MemoryJournalSink();
		const server = createMcpServer(createTodoServerOptions({}, { journal }));
		const agent = { actor: { kind: 'agent' as const } };
		const created = await server.execute('todo-create', { title: 'Approve me' }, agent);
		await server.execute('todo-toggle', { id: (created.data as { id: string }).id }, agent);
		const held = await server.execute('todo-clear', {}, agent);
		const token = (held.error?.details as { approvalToken?: string } | undefined)?.approvalToken;
		expect(token).toBeDefined();
		const approved = await server.execute('todo-clear', {}, { ...agent, approval: token });
		expect(approved.success).toBe(true);

		const entries = await journal.read();
		expect(entries.map((entry) => entry.command)).toEqual([
			'todo-create',
			'todo-toggle',
			'todo-clear',
		]);
		const report = await replayJournal(createReplayRegistry(), entries);
		expect(report.entries.filter((entry) => entry.status !== 'same')).toEqual([]);
	});

	it('loads the replay module without touching the data file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'todo-replay-'));
		try {
			const path = join(dir, 'todos.json');
			const child = spawnSync(
				process.execPath,
				['--import', 'tsx', '--input-type=module', '-e', "await import('./src/registry.ts');"],
				{
					cwd: fileURLToPath(new URL('..', import.meta.url)),
					env: { ...process.env, TODO_STORE_TYPE: 'file', TODO_STORE_PATH: path },
					encoding: 'utf8',
				}
			);
			expect(child.status, child.stderr).toBe(0);
			expect(existsSync(path)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('finds a session that no longer behaves the same', async () => {
		const journal = new MemoryJournalSink();
		await record(journal);
		const entries = await journal.read();
		const edited = entries.map((entry) =>
			entry.command === 'todo-update'
				? { ...entry, input: { ...(entry.input as object), title: 'Changed' } }
				: entry
		);
		const report = await replayJournal(createReplayRegistry(), edited);
		expect(report.diverged).toBe(true);
	});
});

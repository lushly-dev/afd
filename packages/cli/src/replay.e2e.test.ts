/**
 * End-to-end tests for `afd replay`: spawn the built CLI to replay the golden journal
 * fixture, `spec/wire/journal.jsonl`, against the registry that recorded it
 * (`test-fixtures/journal-todo.mjs`).
 *
 * The CLI runs from `dist/bin.js`, which the Vitest global setup rebuilds when stale.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const JOURNAL = fileURLToPath(new URL('../../../spec/wire/journal.jsonl', import.meta.url));
const MODULE = fileURLToPath(new URL('../test-fixtures/journal-todo.mjs', import.meta.url));

interface CliRun {
	code: number | null;
	stdout: string;
	stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [BIN, ...args], {
			env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => resolve({ code, stdout, stderr }));
	});
}

describe('afd replay against the recorded fixture', { timeout: 60_000 }, () => {
	it('replays every entry the same and exits 0', async () => {
		const run = await runCli(['replay', JOURNAL, '--module', MODULE, '--verbose']);
		expect(run.code, run.stdout + run.stderr).toBe(0);
		expect(run.stdout).toContain('✓ #1 todo-create same');
		expect(run.stdout).toContain('✓ #4 todo-list same');
		expect(run.stdout).toContain('✓ #5 todo-scope same');
		expect(run.stdout).toContain(
			'✓ Replay matched: 6 entries replayed, 6 same, 0 different, 0 errors'
		);
	});

	it('reports a structural diff and exits 1 when the registry drifted', async () => {
		const run = await runCli(['replay', JOURNAL, '--module', MODULE, '--format', 'json'], {
			AFD_REPLAY_FIXTURE_DRIFT: '1',
		});
		expect(run.code, run.stderr).toBe(1);
		const report = JSON.parse(run.stdout) as {
			entries: Array<{ seq: number; status: string; differences?: unknown[] }>;
			diverged: boolean;
		};
		expect(report.diverged).toBe(true);
		expect(report.entries.map((entry) => [entry.seq, entry.status])).toEqual([
			[1, 'different'],
			[2, 'different'],
			[3, 'same'],
			[4, 'different'],
			[5, 'same'],
			[6, 'different'],
		]);
		expect(report.entries[0]?.differences).toEqual([
			{ path: 'data.title', kind: 'changed', recorded: 'Buy milk', replayed: 'BUY MILK' },
		]);
	});

	it('exits 2 when the journal cannot be loaded', async () => {
		const run = await runCli(['replay', `${JOURNAL}.missing`, '--module', MODULE]);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain('Cannot read journal');
	});
});

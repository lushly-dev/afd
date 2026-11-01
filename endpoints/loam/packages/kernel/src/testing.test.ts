import type { JournalEntry } from '@lushly-dev/afd-core';
import { defineCommand, success } from '@lushly-dev/afd-server/define';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LoamKernelError } from './errors.js';
import { createDefaultLayout } from './layout.js';
import {
	createFixedEnvironment,
	createReferenceWorkspace,
	createSeededRandom,
	diffJournals,
	recordSession,
	replayKernel,
	SESSION_50,
} from './testing.js';

describe('E2: a replayed journal reproduces the layout', () => {
	it('replays the scripted 50-call session over MemoryAdapter with zero differences', async () => {
		expect(SESSION_50).toHaveLength(50);
		const recorded = await recordSession(SESSION_50);
		// Every call is journaled, refusals included.
		expect(recorded.entries).toHaveLength(50);
		expect(recorded.entries.map((entry) => entry.seq)).toEqual(
			Array.from({ length: 50 }, (_, i) => i + 1)
		);
		expect(recorded.entries.filter((entry) => !entry.result.success).length).toBeGreaterThan(0);

		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.same).toBe(50);
		expect(replayed.report.different).toBe(0);
		expect(replayed.report.errors).toBe(0);
		expect(replayed.layout).toEqual(recorded.layout);
		expect(replayed.appearance).toEqual(recorded.appearance);
	});

	it('records the session through both interfaces', async () => {
		const { entries } = await recordSession(SESSION_50);
		const interfaces = new Set(entries.map((entry) => entry.contextDigest.interface));
		expect(interfaces).toEqual(new Set(['palette', 'agent']));
		const agentEntries = entries.filter((entry) => entry.contextDigest.interface === 'agent');
		expect(agentEntries.length).toBe(
			SESSION_50.filter((call) => call.interface === 'agent').length
		);
	});

	it('ends the session in the expected layout', async () => {
		const { layout, appearance } = await recordSession(SESSION_50);
		expect(layout).toEqual({
			version: 0,
			sidebar: { open: true, width: 300 },
			inspector: { open: true, width: 520 },
			panel: { open: false, height: 240, maximized: false },
			compact: { drawer: null, sheet: false },
		});
		expect(appearance).toEqual({ theme: 'system', density: 'comfortable', resolved: 'light' });
	});

	it('ignores the environment: a dark recording replays in a light environment', async () => {
		const recorded = await recordSession(SESSION_50, {
			environment: createFixedEnvironment(['(prefers-color-scheme: dark)']),
		});
		expect(recorded.appearance.resolved).toBe('dark');
		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.diverged).toBe(false);
		expect(replayed.appearance.resolved).toBe('light');
	});

	it('replays an empty journal to the defaults', async () => {
		const replayed = await replayKernel([]);
		expect(replayed.report.entries).toEqual([]);
		expect(replayed.layout).toEqual(createDefaultLayout());
	});

	it('refuses a journal that does not start at seq 1', async () => {
		const { entries } = await recordSession(SESSION_50);
		const error = await replayKernel(entries.slice(5)).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoamKernelError);
		expect((error as LoamKernelError).code).toBe('REPLAY_START_INVALID');
		expect((error as LoamKernelError).details).toEqual({ firstSeq: 6 });
	});

	it('fails a divergence with the first difference', async () => {
		const { entries } = await recordSession(SESSION_50);
		const tampered: JournalEntry[] = structuredClone(entries);
		const target = tampered.findIndex(
			(entry) => entry.command === 'layout-set' && entry.result.success
		);
		const entry = tampered[target] as JournalEntry;
		(entry.result.data as { sidebar: { width: number } }).sidebar.width = 999;
		const error = await replayKernel(tampered).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(LoamKernelError);
		const refusal = error as LoamKernelError;
		expect(refusal.code).toBe('REPLAY_DIVERGED');
		expect(refusal.message).toContain(`seq ${entry.seq}`);
		expect(refusal.message).toContain('data.sidebar.width');
		expect(refusal.details?.firstDifference).toMatchObject({
			seq: entry.seq,
			command: 'layout-set',
			difference: { path: 'data.sidebar.width', kind: 'changed', recorded: 999 },
		});
	});

	it('replays extra commands given to the recording kernel', async () => {
		const notesCreate = defineCommand({
			name: 'notes-create',
			description: 'Create a note',
			mutation: true,
			input: z.object({ title: z.string() }),
			async handler(input, context) {
				return success({ title: input.title, id: Math.floor((context.random?.next() ?? 0) * 1e6) });
			},
		});
		const commands = [notesCreate as never];
		const recorded = await recordSession(
			[{ interface: 'agent', name: 'notes-create', input: { title: 'A' } }],
			{ commands }
		);
		expect(recorded.entries).toHaveLength(1);
		expect(recorded.entries[0]?.tape?.random).toHaveLength(1);
		const replayed = await replayKernel(recorded.entries, { commands });
		expect(replayed.report.same).toBe(1);
	});
});

describe('diffJournals (A3)', () => {
	it('finds two recordings of the same session equal, ignoring timestamps and durations', async () => {
		const a = await recordSession(SESSION_50);
		const b = await recordSession(SESSION_50, { start: Date.UTC(2027, 5, 1), seed: 'other' });
		expect(a.entries[0]?.timestamp).not.toBe(b.entries[0]?.timestamp);
		expect(diffJournals(a.entries, b.entries)).toEqual({
			equal: true,
			counts: { a: 50, b: 50, same: 50, different: 0 },
		});
	});

	it('names the first difference by index and field', async () => {
		const { entries } = await recordSession(SESSION_50);
		const commandChanged = structuredClone(entries);
		(commandChanged[3] as JournalEntry).command = 'layout-get';
		expect(diffJournals(entries, commandChanged).firstDifference).toEqual({
			index: 3,
			field: 'command',
		});

		const inputChanged = structuredClone(entries);
		(inputChanged[5] as JournalEntry).input = { sidebar: { width: 321 } };
		expect(diffJournals(entries, inputChanged)).toMatchObject({
			equal: false,
			firstDifference: { index: 5, field: 'input', path: 'sidebar.width' },
			counts: { same: 49, different: 1 },
		});

		const successChanged = structuredClone(entries);
		(successChanged[6] as JournalEntry).result = {
			success: false,
			error: { code: 'X', message: 'x' },
		};
		expect(diffJournals(entries, successChanged).firstDifference).toEqual({
			index: 6,
			field: 'success',
		});

		const resultChanged = structuredClone(entries);
		(resultChanged[1] as JournalEntry).result.data = { ...createDefaultLayout(), version: 1 };
		expect(diffJournals(entries, resultChanged).firstDifference).toEqual({
			index: 1,
			field: 'result',
			path: 'data.version',
		});
	});

	it('counts entries past the shorter journal as different', async () => {
		const { entries } = await recordSession(SESSION_50);
		expect(diffJournals(entries, entries.slice(0, 48))).toEqual({
			equal: false,
			firstDifference: { index: 48, field: 'length' },
			counts: { a: 50, b: 48, same: 48, different: 2 },
		});
	});

	it('takes extra ignored paths', async () => {
		const light = await recordSession(SESSION_50);
		const dark = await recordSession(SESSION_50, {
			environment: createFixedEnvironment(['(prefers-color-scheme: dark)']),
		});
		expect(diffJournals(light.entries, dark.entries).firstDifference).toMatchObject({
			field: 'result',
			path: 'data.resolved',
		});
		expect(diffJournals(light.entries, dark.entries, { ignore: ['data.resolved'] }).equal).toBe(
			true
		);
	});
});

describe('createReferenceWorkspace (D37)', () => {
	it('is deterministic for a seed', () => {
		const a = createReferenceWorkspace({ seed: 'phase-0', size: 500 });
		const b = createReferenceWorkspace({ seed: 'phase-0', size: 500 });
		const c = createReferenceWorkspace({ seed: 'other', size: 500 });
		expect(a).toEqual(b);
		expect(a.commands).not.toEqual(c.commands);
	});

	it('generates size unique, valid command names and 200 queries', () => {
		const workspace = createReferenceWorkspace({ seed: 'phase-0', size: 5000 });
		expect(workspace.commands).toHaveLength(5000);
		const names = workspace.commands.map((command) => command.name);
		expect(new Set(names).size).toBe(5000);
		for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$/);
		expect(workspace.queries).toHaveLength(200);
		expect(workspace.calls).toHaveLength(5000);
	});

	it('generates calls that are all journaled and replay without differences', async () => {
		const workspace = createReferenceWorkspace({ seed: 'phase-0', size: 400 });
		const recorded = await recordSession(workspace.calls);
		expect(recorded.entries).toHaveLength(400);
		const replayed = await replayKernel(recorded.entries);
		expect(replayed.report.same).toBe(400);
		const again = await recordSession(workspace.calls, { seed: 'second' });
		expect(diffJournals(recorded.entries, again.entries).equal).toBe(true);
	});

	it('seeds a random source in [0, 1)', () => {
		const random = createSeededRandom('x');
		const values = Array.from({ length: 1000 }, random);
		expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
		expect(createSeededRandom('x')()).toBe(values[0]);
	});
});

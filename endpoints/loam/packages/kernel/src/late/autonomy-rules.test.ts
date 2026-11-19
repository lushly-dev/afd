/**
 * Autonomy's pure rules (phase 4 specification, 4.1 and 4.2; D156): the row id, the default, resolution with its
 * ceilings and cap, the bound a project row meets when written (F8), and which rows an apply orphans.
 */

import { describe, expect, it } from 'vitest';
import {
	type AutonomyCommandV1,
	type AutonomyRowV1,
	autonomyRowId,
	defaultMode,
	lowerOf,
	orphanChanges,
	resolveAutonomy,
	writeBound,
} from './autonomy-rules.js';

const row = (fields: Omit<AutonomyRowV1, 'id' | 'updatedAt' | 'updatedBy'>): AutonomyRowV1 => ({
	id: autonomyRowId(fields),
	updatedAt: 1,
	updatedBy: 'local',
	...fields,
});

const READ: AutonomyCommandV1 = {
	name: 'tally-get',
	instance: 'tally',
	mutation: false,
	mounted: false,
};
const WRITE: AutonomyCommandV1 = {
	name: 'tally-add',
	instance: 'tally',
	mutation: true,
	mounted: false,
};
const RESET: AutonomyCommandV1 = {
	name: 'tally-reset',
	instance: 'tally',
	mutation: true,
	mounted: false,
};
const TOOL: AutonomyCommandV1 = {
	name: 'work-read',
	instance: 'work',
	mutation: false,
	mounted: true,
};

describe('the record (4.1)', () => {
	it('names a row by level, project, instance and command', () => {
		expect(autonomyRowId({ level: 'workspace' })).toBe('workspace/-/*/*');
		expect(autonomyRowId({ level: 'workspace', instance: 'tally', command: 'tally-reset' })).toBe(
			'workspace/-/tally/tally-reset'
		);
		expect(autonomyRowId({ level: 'project', project: 'prj_atlas', instance: 'tally' })).toBe(
			'project/prj_atlas/tally/*'
		);
	});

	it('orders the modes strictest first', () => {
		expect(lowerOf('act', 'ask')).toBe('ask');
		expect(lowerOf('suggest', 'act')).toBe('suggest');
	});
});

describe('resolution (4.2)', () => {
	it('defaults to act on reads, ask before changes, and ask before any mounted tool (D156)', () => {
		expect(defaultMode(READ)).toBe('act');
		expect(defaultMode(WRITE)).toBe('ask');
		expect(defaultMode(TOOL)).toBe('ask');
		for (const command of [READ, WRITE, TOOL]) {
			expect(resolveAutonomy({ rows: [], command })).toEqual({
				mode: defaultMode(command),
				from: 'default',
				ceilings: [],
				cap: null,
				chain: [{ id: 'default', mode: defaultMode(command), as: 'mode' }],
			});
		}
	});

	it('takes the most specific row of the project, else of the workspace', () => {
		const rows = [
			row({ level: 'workspace', mode: 'ask', ceiling: 'act' }),
			row({ level: 'workspace', instance: 'tally', mode: 'act' }),
			row({ level: 'project', project: 'prj_atlas', mode: 'act' }),
			row({
				level: 'project',
				project: 'prj_atlas',
				instance: 'tally',
				command: 'tally-reset',
				mode: 'ask',
			}),
		];
		expect(resolveAutonomy({ rows, command: RESET, project: 'prj_atlas' })).toMatchObject({
			mode: 'ask',
			from: 'project/prj_atlas/tally/tally-reset',
		});
		expect(resolveAutonomy({ rows, command: WRITE, project: 'prj_atlas' })).toMatchObject({
			mode: 'act',
			from: 'project/prj_atlas/*/*',
		});
		// Another project, and no project: the workspace's instance row.
		for (const project of ['prj_beacon', undefined]) {
			expect(resolveAutonomy({ rows, command: WRITE, project })).toMatchObject({
				mode: 'act',
				from: 'workspace/-/tally/*',
				ceilings: [],
			});
		}
	});

	it("bounds a project row by the workspace's ceiling, else its general mode, else the default, and its rows", () => {
		const project = row({ level: 'project', project: 'prj_atlas', mode: 'act' });
		// No workspace row: the default for the command.
		expect(
			resolveAutonomy({ rows: [project], command: WRITE, project: 'prj_atlas' })
		).toMatchObject({
			mode: 'ask',
			ceilings: [{ id: 'default', mode: 'ask' }],
		});
		expect(resolveAutonomy({ rows: [project], command: READ, project: 'prj_atlas' }).mode).toBe(
			'act'
		);
		// The general mode, then the ceiling in its place.
		const general = row({ level: 'workspace', mode: 'suggest' });
		expect(
			resolveAutonomy({ rows: [general, project], command: READ, project: 'prj_atlas' }).mode
		).toBe('suggest');
		const ceiling = row({ level: 'workspace', mode: 'suggest', ceiling: 'act' });
		const resolved = resolveAutonomy({
			rows: [
				ceiling,
				project,
				row({ level: 'workspace', instance: 'tally', command: 'tally-reset', mode: 'suggest' }),
			],
			command: RESET,
			project: 'prj_atlas',
		});
		expect(resolved).toMatchObject({
			mode: 'suggest',
			from: 'project/prj_atlas/*/*',
			ceilings: [
				{ id: 'workspace/-/*/*', mode: 'act' },
				{ id: 'workspace/-/tally/tally-reset', mode: 'suggest' },
			],
		});
		expect(resolved.chain.map(({ as }) => as)).toEqual(['mode', 'ceiling', 'ceiling']);
	});

	it("lowers to the person's cap, last, and names it in the chain", () => {
		const rows = [row({ level: 'workspace', mode: 'act' })];
		expect(resolveAutonomy({ rows, command: READ, cap: 'suggest' })).toMatchObject({
			mode: 'suggest',
			cap: 'suggest',
			chain: [
				{ id: 'workspace/-/*/*', mode: 'act', as: 'mode' },
				{ id: 'cap', mode: 'suggest', as: 'cap' },
			],
		});
		// A cap only lowers.
		expect(resolveAutonomy({ rows, command: WRITE, cap: 'act' }).mode).toBe('act');
		expect(resolveAutonomy({ rows: [], command: WRITE, cap: 'act' }).mode).toBe('ask');
	});

	it('ignores orphans and rows of other projects, and a workspace row holding a ceiling alone', () => {
		const rows = [
			{
				...row({ level: 'workspace', instance: 'tally', command: 'tally-get', mode: 'suggest' }),
				orphan: true as const,
			},
			row({ level: 'project', project: 'prj_beacon', mode: 'suggest' }),
			row({ level: 'workspace', ceiling: 'act' }),
		];
		expect(resolveAutonomy({ rows, command: READ, project: 'prj_atlas' })).toMatchObject({
			mode: 'act',
			from: 'default',
		});
		expect(
			resolveAutonomy({ rows, command: READ, project: 'prj_atlas' }).chain.map(({ id }) => id)
		).toEqual(['default']);
	});

	it('resolves a mounted tool to ask until a row says otherwise', () => {
		expect(resolveAutonomy({ rows: [], command: TOOL }).mode).toBe('ask');
		const rows = [row({ level: 'workspace', instance: 'work', mode: 'act' })];
		expect(resolveAutonomy({ rows, command: TOOL }).mode).toBe('act');
	});
});

describe('the write-time bound (4.2, F8)', () => {
	it('bounds a general or instance project row by ask when the workspace sets neither mode nor ceiling', () => {
		expect(writeBound([], { level: 'project' })).toEqual({ id: 'default', mode: 'ask' });
		expect(writeBound([], { level: 'project', instance: 'tally' })).toEqual({
			id: 'default',
			mode: 'ask',
		});
		expect(writeBound([], { level: 'workspace' })).toBeUndefined();
	});

	it('bounds a command row by its own default, so a read may act', () => {
		expect(writeBound([], { level: 'project', instance: 'tally', command: READ })).toEqual({
			id: 'default',
			mode: 'act',
		});
		expect(writeBound([], { level: 'project', instance: 'tally', command: WRITE })?.mode).toBe(
			'ask'
		);
	});

	it("takes the workspace's ceiling, else its general mode, and the tightest of its instance and command rows", () => {
		const rows = [
			row({ level: 'workspace', mode: 'ask', ceiling: 'act' }),
			row({ level: 'workspace', instance: 'tally', mode: 'ask' }),
			row({ level: 'workspace', instance: 'tally', command: 'tally-reset', mode: 'suggest' }),
		];
		expect(writeBound(rows, { level: 'project' })).toEqual({ id: 'workspace/-/*/*', mode: 'act' });
		expect(writeBound(rows, { level: 'project', instance: 'tally' })).toEqual({
			id: 'workspace/-/tally/*',
			mode: 'ask',
		});
		expect(writeBound(rows, { level: 'project', instance: 'tally', command: RESET })).toEqual({
			id: 'workspace/-/tally/tally-reset',
			mode: 'suggest',
		});
		expect(
			writeBound([row({ level: 'workspace', mode: 'suggest' })], { level: 'project' })
		).toEqual({
			id: 'workspace/-/*/*',
			mode: 'suggest',
		});
	});
});

describe('orphans (4.2)', () => {
	const rows = [
		row({ level: 'workspace', mode: 'ask' }),
		row({ level: 'workspace', instance: 'tally', command: 'tally-reset', mode: 'ask' }),
		row({ level: 'workspace', instance: 'gone', mode: 'ask' }),
		row({ level: 'workspace', instance: 'work', command: 'work-read', mode: 'ask' }),
		{
			...row({
				level: 'project',
				project: 'prj_atlas',
				instance: 'tally',
				command: 'tally-add',
				mode: 'ask',
			}),
			orphan: true as const,
		},
	];

	it('flags a row whose instance or command is gone, and unflags one backed again', () => {
		const commands = new Map([['tally', new Set(['tally-add', 'tally-get'])]]);
		const changes = orphanChanges(rows, new Set(['shell', 'tally', 'work']), (instance) =>
			instance === 'work' ? undefined : (commands.get(instance) ?? new Set())
		);
		expect(changes).toEqual({
			orphaned: ['workspace/-/gone/*', 'workspace/-/tally/tally-reset'],
			restored: ['project/prj_atlas/tally/tally-add'],
		});
	});

	it("judges a mounted instance's command only once its catalog is known", () => {
		const unknown = orphanChanges(rows, new Set(['tally', 'work']), (instance) =>
			instance === 'work' ? undefined : new Set(['tally-reset', 'tally-add'])
		);
		expect(unknown.orphaned).not.toContain('workspace/-/work/work-read');
		const known = orphanChanges(rows, new Set(['tally', 'work']), () => new Set(['tally-reset']));
		expect(known.orphaned).toContain('workspace/-/work/work-read');
	});
});

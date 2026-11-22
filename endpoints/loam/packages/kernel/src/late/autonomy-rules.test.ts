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
	name: 'counter-get',
	instance: 'counter',
	mutation: false,
	mounted: false,
};
const WRITE: AutonomyCommandV1 = {
	name: 'counter-add',
	instance: 'counter',
	mutation: true,
	mounted: false,
};
const RESET: AutonomyCommandV1 = {
	name: 'counter-reset',
	instance: 'counter',
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
		expect(
			autonomyRowId({ level: 'workspace', instance: 'counter', command: 'counter-reset' })
		).toBe('workspace/-/counter/counter-reset');
		expect(autonomyRowId({ level: 'project', project: 'prj_atlas', instance: 'counter' })).toBe(
			'project/prj_atlas/counter/*'
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
		// A `per-part` instance's reads act; its mutations still ask (phase 5 specification, 6.1).
		expect(defaultMode({ ...TOOL, mutation: false, vouched: true })).toBe('act');
		expect(defaultMode({ ...TOOL, mutation: true, vouched: true })).toBe('ask');
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
			row({ level: 'workspace', instance: 'counter', mode: 'act' }),
			row({ level: 'project', project: 'prj_atlas', mode: 'act' }),
			row({
				level: 'project',
				project: 'prj_atlas',
				instance: 'counter',
				command: 'counter-reset',
				mode: 'ask',
			}),
		];
		expect(resolveAutonomy({ rows, command: RESET, project: 'prj_atlas' })).toMatchObject({
			mode: 'ask',
			from: 'project/prj_atlas/counter/counter-reset',
		});
		expect(resolveAutonomy({ rows, command: WRITE, project: 'prj_atlas' })).toMatchObject({
			mode: 'act',
			from: 'project/prj_atlas/*/*',
		});
		// Another project, and no project: the workspace's instance row.
		for (const project of ['prj_beacon', undefined]) {
			expect(resolveAutonomy({ rows, command: WRITE, project })).toMatchObject({
				mode: 'act',
				from: 'workspace/-/counter/*',
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
				row({ level: 'workspace', instance: 'counter', command: 'counter-reset', mode: 'suggest' }),
			],
			command: RESET,
			project: 'prj_atlas',
		});
		expect(resolved).toMatchObject({
			mode: 'suggest',
			from: 'project/prj_atlas/*/*',
			ceilings: [
				{ id: 'workspace/-/*/*', mode: 'act' },
				{ id: 'workspace/-/counter/counter-reset', mode: 'suggest' },
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

	it('decides by no orphan, but bounds by it (R1); ignores other projects and a ceiling-only general row', () => {
		const orphan = {
			...row({ level: 'workspace', instance: 'counter', command: 'counter-get', mode: 'suggest' }),
			orphan: true as const,
		};
		const rows = [
			orphan,
			row({ level: 'project', project: 'prj_beacon', mode: 'suggest' }),
			row({ level: 'workspace', ceiling: 'act' }),
		];
		const resolved = resolveAutonomy({ rows, command: READ, project: 'prj_atlas' });
		expect(resolved).toMatchObject({
			mode: 'suggest',
			from: 'default',
			ceilings: [{ id: orphan.id, mode: 'suggest' }],
		});
		expect(resolved.chain.map(({ id, as }) => [id, as])).toEqual([
			['default', 'mode'],
			[orphan.id, 'ceiling'],
		]);
		// Flagging a restrictive row never loosens: the same rows unflagged resolve the same mode.
		const whole = resolveAutonomy({ rows: [{ ...orphan, orphan: undefined }], command: READ });
		expect(whole.mode).toBe('suggest');
		// An orphan for another command of the instance bounds nothing here.
		expect(resolveAutonomy({ rows, command: { ...READ, name: 'counter-list' } }).mode).toBe('act');
		// An orphaned instance row bounds every command of the instance, and a project's orphan its project only.
		const instanceOrphan = {
			...row({ level: 'workspace', instance: 'counter', mode: 'ask' }),
			orphan: true as const,
		};
		expect(resolveAutonomy({ rows: [instanceOrphan], command: READ }).mode).toBe('ask');
		const projectOrphan = {
			...row({ level: 'project', project: 'prj_atlas', instance: 'counter', mode: 'suggest' }),
			orphan: true as const,
		};
		expect(
			resolveAutonomy({ rows: [projectOrphan], command: READ, project: 'prj_atlas' }).mode
		).toBe('suggest');
		expect(
			resolveAutonomy({ rows: [projectOrphan], command: READ, project: 'prj_beacon' }).mode
		).toBe('act');
	});

	it('bounds a project row at write time by an orphaned workspace row too (R1)', () => {
		const orphan = {
			...row({
				level: 'workspace',
				instance: 'counter',
				command: 'counter-reset',
				mode: 'suggest',
			}),
			orphan: true as const,
		};
		expect(writeBound([orphan], { level: 'project', instance: 'counter', command: RESET })).toEqual(
			{
				id: orphan.id,
				mode: 'suggest',
			}
		);
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
		expect(writeBound([], { level: 'project', instance: 'counter' })).toEqual({
			id: 'default',
			mode: 'ask',
		});
		expect(writeBound([], { level: 'workspace' })).toBeUndefined();
	});

	it('bounds a command row by its own default, so a read may act', () => {
		expect(writeBound([], { level: 'project', instance: 'counter', command: READ })).toEqual({
			id: 'default',
			mode: 'act',
		});
		expect(writeBound([], { level: 'project', instance: 'counter', command: WRITE })?.mode).toBe(
			'ask'
		);
	});

	it("takes the workspace's ceiling, else its general mode, and the tightest of its instance and command rows", () => {
		const rows = [
			row({ level: 'workspace', mode: 'ask', ceiling: 'act' }),
			row({ level: 'workspace', instance: 'counter', mode: 'ask' }),
			row({ level: 'workspace', instance: 'counter', command: 'counter-reset', mode: 'suggest' }),
		];
		expect(writeBound(rows, { level: 'project' })).toEqual({ id: 'workspace/-/*/*', mode: 'act' });
		expect(writeBound(rows, { level: 'project', instance: 'counter' })).toEqual({
			id: 'workspace/-/counter/*',
			mode: 'ask',
		});
		expect(writeBound(rows, { level: 'project', instance: 'counter', command: RESET })).toEqual({
			id: 'workspace/-/counter/counter-reset',
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

describe('orphans (4.2; R1, R2)', () => {
	const tracked = (fields: Parameters<typeof row>[0], app = 'plugin:counter') => ({
		...row(fields),
		app,
	});
	const rows = [
		row({ level: 'workspace', mode: 'ask' }),
		tracked({ level: 'workspace', instance: 'counter', command: 'counter-reset', mode: 'ask' }),
		tracked({ level: 'workspace', instance: 'gone', mode: 'ask' }, 'plugin:gone'),
		tracked(
			{ level: 'workspace', instance: 'work', command: 'work-read', mode: 'ask' },
			'mounted:umbel:http:w'
		),
		{
			...tracked({
				level: 'project',
				project: 'prj_atlas',
				instance: 'counter',
				command: 'counter-add',
				mode: 'ask',
			}),
			orphan: true as const,
		},
	];
	const known = (commands: string[] | undefined, identity = 'plugin:counter') => ({
		identity,
		commands: commands === undefined ? undefined : new Set(commands),
	});

	it('flags a row whose instance or command is gone, and unflags one backed again by the same app', () => {
		const changes = orphanChanges(rows, (instance) =>
			instance === 'counter'
				? known(['counter-add', 'counter-get'])
				: instance === 'work'
					? known(undefined, 'mounted:umbel:http:w')
					: undefined
		);
		expect(changes).toEqual({
			orphaned: ['workspace/-/counter/counter-reset', 'workspace/-/gone/*'],
			restored: ['project/prj_atlas/counter/counter-add'],
		});
	});

	it('leaves every flag as it is while a catalog or an identity is unknown', () => {
		const unknown = orphanChanges(rows, (instance) =>
			instance === 'gone'
				? undefined
				: known(undefined, instance === 'work' ? 'mounted:umbel:http:w' : 'plugin:counter')
		);
		expect(unknown).toEqual({ orphaned: ['workspace/-/gone/*'], restored: [] });
		const noIdentity = orphanChanges(rows, () => ({ identity: undefined, commands: new Set() }));
		expect(noIdentity).toEqual({ orphaned: [], restored: [] });
	});

	it('flags a row whose instance now runs another app, and a command name alone never backs it (R2)', () => {
		const swapped = orphanChanges(rows, (instance) =>
			instance === 'counter'
				? known(['counter-add', 'counter-reset'], 'plugin:impostor')
				: known(['work-read'], 'mounted:umbel:http:other')
		);
		expect(swapped.orphaned).toEqual([
			'workspace/-/counter/counter-reset',
			'workspace/-/gone/*',
			'workspace/-/work/work-read',
		]);
		expect(swapped.restored).toEqual([]);
		// A row stored with no identity is never backed.
		const bare = [
			{ ...row({ level: 'workspace', instance: 'counter', mode: 'ask' }), orphan: true as const },
		];
		expect(orphanChanges(bare, () => known(['counter-add']))).toEqual({
			orphaned: [],
			restored: [],
		});
	});
});

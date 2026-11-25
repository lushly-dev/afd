/**
 * @fileoverview The four `control-*` commands (the specification's sections 4 to 8), and the
 * exit list of its section 10 that the scenarios do not cover.
 */

import {
	createDirectRegistry,
	createDirectToolSurface,
	type ZodCommandDefinition,
	zodToJsonSchema,
} from '@lushly-dev/afd-server';
import type { CommandResult } from '@lushly-dev/afd-server/define';
import { evaluateResult } from '@lushly-dev/afd-testing';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createViewStateCommands } from '../commands.js';
import { ViewStateRegistry } from '../registry.js';
import {
	type ControlChoicesResult,
	type ControlCommands,
	type ControlListCommand,
	type ControlListResult,
	type ControlRestoreResult,
	type ControlSetCommand,
	type ControlSetResult,
	createControlCommands,
} from './commands.js';
import { ControlRegistry } from './registry.js';
import type { ControlState, ControlValue } from './types.js';

// ─── A form to fill ──────────────────────────────────────────────────────────

type ActorKind = 'human' | 'agent' | 'service' | 'script' | 'test';

/** A registry over plain states, with hooks to make a write move or throw and a read throw. */
function form(controls: Record<string, Partial<ControlState>>) {
	let tokens = 0;
	const registry = new ControlRegistry({ token: () => `t${++tokens}` });
	const states = new Map<string, ControlState>();
	const onWrite = new Map<string, (value: ControlValue) => void>();
	const failRead = new Set<string>();
	const writes: Array<[string, ControlValue]> = [];
	const state = (id: string) => states.get(id) as ControlState;
	const bind = (id: string) =>
		registry.register(id, {
			read() {
				if (failRead.has(id)) throw new Error('the element is gone');
				return structuredClone(state(id));
			},
			write(value) {
				writes.push([id, value]);
				onWrite.get(id)?.(value);
				state(id).value = value;
			},
		});
	for (const [id, partial] of Object.entries(controls)) {
		states.set(id, { kind: 'text', label: id, value: '', ...partial });
		bind(id);
	}
	const commands = createControlCommands(registry);
	const direct = createDirectRegistry(commands as ZodCommandDefinition[]);
	const run = <T = unknown>(
		name: string,
		input: Record<string, unknown>,
		actor: ActorKind | undefined = 'agent',
		options?: Parameters<typeof direct.execute>[3]
	) => direct.execute<T>(name, input, actor ? { actor: { kind: actor } } : {}, options);
	const list = async (input: Record<string, unknown> = {}) =>
		(await run<ControlListResult>('control-list', { limit: 100, ...input }))
			.data as ControlListResult;
	const revs = async () =>
		Object.fromEntries(
			(await list()).controls.map((control) => [control.id, control.rev as string])
		);
	const set = (
		values: Array<{ id: string; value: ControlValue; rev: string }>,
		actor?: ActorKind
	) => run<ControlSetResult>('control-set', { values }, actor);
	const restore = (controls: Array<{ id: string; rev: string }>, actor?: ActorKind) =>
		run<ControlRestoreResult>('control-restore', { controls }, actor);
	const values = () => Object.fromEntries([...states].map(([id, s]) => [id, s.value]));
	return {
		registry,
		states,
		state,
		onWrite,
		failRead,
		writes,
		bind,
		commands,
		direct,
		run,
		list,
		revs,
		set,
		restore,
		values,
	};
}

/** Whether a reader keeps the error's recovery: afd-testing reads it only when it passes isCommandRecovery. */
function recoveryIsReadable(result: CommandResult<unknown>): boolean {
	const recovery = result.error?.recovery;
	if (recovery === undefined) return false;
	return evaluateResult(result, { success: false, error: { recovery: { kind: recovery.kind } } })
		.passed;
}

const SESSIONS = [
	{ value: 'morning', label: 'Morning' },
	{ value: 'evening', label: 'Evening' },
];

function commandNamed(commands: ControlCommands, name: string): ZodCommandDefinition {
	const found = (commands as ZodCommandDefinition[]).find((command) => command.name === name);
	if (!found) throw new Error(`No command ${name}`);
	return found;
}

// ─── Definitions ─────────────────────────────────────────────────────────────

describe('the written JSON Schemas', () => {
	it('hold equal to the schemas they stand for', () => {
		const commands = createControlCommands(new ControlRegistry()) as ZodCommandDefinition[];
		for (const command of commands) {
			expect(command.jsonSchema, command.name).toEqual(zodToJsonSchema(command.inputSchema));
			expect(command.outputSchema, command.name).toBeDefined();
			expect(command.outputJsonSchema, command.name).toEqual(
				zodToJsonSchema(command.outputSchema as NonNullable<typeof command.outputSchema>, {
					io: 'output',
				})
			);
		}
	});
});

describe('the definitions', () => {
	const commands = createControlCommands(new ControlRegistry());

	it('are the four commands, in a fixed order, each in the control category and instant', () => {
		expect(commands.map((command) => command.name)).toEqual([
			'control-list',
			'control-set',
			'control-restore',
			'control-choices',
		]);
		for (const command of commands) {
			expect(command.category).toBe('control');
			expect(command.executionTime).toBe('instant');
		}
	});

	it('carry the metadata of the specification', () => {
		const [list, set, restore, choices] = commands;
		expect(list).toMatchObject({
			mutation: false,
			errors: ['NOT_FOUND', 'INTERNAL_ERROR'],
			outputBudget: { defaultBytes: 16384, maxBytes: 65536 },
		});
		expect(set).toMatchObject({
			mutation: true,
			approval: 'not-required',
			undoable: true,
			requires: ['control-list'],
			errors: ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'VALIDATION_ERROR', 'INTERNAL_ERROR'],
		});
		expect(restore).toMatchObject({
			mutation: true,
			approval: 'not-required',
			errors: ['INTERNAL_ERROR'],
		});
		expect(choices).toMatchObject({
			mutation: false,
			requires: ['control-list'],
			errors: ['NOT_FOUND', 'VALIDATION_ERROR', 'INTERNAL_ERROR'],
		});
	});

	it("describe what a model must know, in the specification's words", () => {
		expect(commands.map((command) => command.description)).toEqual([
			"List the controls on the screen the person is looking at: each one's id, label, kind, value, limits and choices, and the rev to send back when changing it. Read this before control-set.",
			"Set the values of controls on the person's screen, all or none. Send each control's id (not its label), a value of its kind (a choice by its value or its label), and the rev control-list or an earlier result gave for it; never invent a rev. If a control changed since you read it, read it again and keep what the person entered unless they ask otherwise. A secret is the person's to type. This fills a draft and does not submit it: run the form's command only when the person asks, with what the screen then shows. An error's details list every refused value.",
			"Put back what controls held before a control-set changed them, skipping any the person has changed since. Send the id and rev of each control as control-set's result gave them.",
			'Search or page through the choices of one control that offers more than control-list carries.',
		]);
	});

	it('destructure into precisely typed commands, and are still an array', () => {
		const [list, set] = commands;
		expectTypeOf(list).toEqualTypeOf<ControlListCommand>();
		expectTypeOf(set).toEqualTypeOf<ControlSetCommand>();
		expectTypeOf(list.handler).parameter(0).toEqualTypeOf<{
			group?: string | undefined;
			limit: number;
			offset: number;
		}>();
		const asArray: ZodCommandDefinition[] = commands;
		expect(asArray).toHaveLength(4);
	});
});

describe('exposure', () => {
	it('goes to the in-app agent by default, and control-restore to the palette as well', () => {
		const commands = createControlCommands(new ControlRegistry());
		const agentOnly = { agent: true, palette: false, mcp: false, cli: false };
		expect(commands.map((command) => command.expose)).toEqual([
			agentOnly,
			agentOnly,
			{ agent: true, palette: true, mcp: false, cli: false },
			agentOnly,
		]);
		expect(createDirectRegistry(commands).listCommandNames()).toEqual([
			'control-list',
			'control-set',
			'control-restore',
			'control-choices',
		]);
		expect(createDirectRegistry(commands, { interface: 'palette' }).listCommandNames()).toEqual([
			'control-restore',
		]);
		expect(createDirectRegistry(commands, { interface: 'mcp' }).listCommandNames()).toEqual([]);
		expect(createDirectRegistry(commands, { interface: 'cli' }).listCommandNames()).toEqual([]);
	});

	it('merges the expose option over each default', () => {
		const commands = createControlCommands(new ControlRegistry(), { expose: { mcp: true } });
		expect(commands.map((command) => command.expose)).toEqual([
			{ agent: true, palette: false, mcp: true, cli: false },
			{ agent: true, palette: false, mcp: true, cli: false },
			{ agent: true, palette: true, mcp: true, cli: false },
			{ agent: true, palette: false, mcp: true, cli: false },
		]);
		expect(createDirectRegistry(commands, { interface: 'mcp' }).listCommandNames()).toHaveLength(4);
	});
});

describe('allow on a direct registry with view state and controls', () => {
	function both() {
		const viewStates = new ViewStateRegistry();
		const panel = { open: false };
		viewStates.register('panel', {
			get: () => ({ ...panel }),
			set: (partial) => Object.assign(panel, partial),
		});
		const controls = new ControlRegistry();
		controls.register('name', {
			read: () => ({ kind: 'text', label: 'Name', value: '' }),
			write() {},
		});
		const direct = createDirectRegistry(
			[
				...createViewStateCommands(viewStates),
				...(createControlCommands(controls) as ZodCommandDefinition[]),
			],
			{ tools: createDirectToolSurface() }
		);
		return { direct, panel };
	}

	it('for view-state-* alone, runs view state and lists and runs no control-* command', async () => {
		const { direct } = both();
		const allow = (name: string) => name.startsWith('view-state-');

		const viewState = await direct.execute('view-state-list', {}, {}, { allow });
		const control = await direct.execute('control-list', {}, {}, { allow });
		const tools = direct.listTools({ allow }).map((tool) => tool.name);

		expect(viewState.success).toBe(true);
		expect(control.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(tools).toContain('view-state-list');
		expect(tools.filter((name) => name.startsWith('control-'))).toEqual([]);
	});

	it('for control-* alone, does not run view-state-set', async () => {
		const { direct, panel } = both();
		const allow = (name: string) => name.startsWith('control-');

		const control = await direct.execute('control-list', {}, {}, { allow });
		const viewState = await direct.execute(
			'view-state-set',
			{ id: 'panel', state: { open: true } },
			{},
			{ allow }
		);

		expect(control.success).toBe(true);
		expect(viewState.error?.code).toBe('COMMAND_NOT_ALLOWED');
		expect(panel.open).toBe(false);
		expect(direct.listTools({ allow }).map((tool) => tool.name)).not.toContain('view-state-set');
	});
});

// ─── control-list ────────────────────────────────────────────────────────────

describe('control-list', () => {
	it('gives each control as section 4.2 does, a false flag left out', async () => {
		const f = form({
			name: {
				label: 'Name',
				group: 'You',
				value: 'Ada',
				required: true,
				maxLength: 40,
				disabled: false,
			},
			seats: {
				kind: 'number',
				label: 'Seats',
				value: 1,
				min: 1,
				max: 4,
				description: 'Up to four',
			},
			when: { kind: 'text', label: 'Date', format: 'date', value: '', error: 'Pick a date' },
		});

		const { controls } = await f.list();

		expect(controls).toEqual([
			{
				id: 'name',
				rev: '1-t1',
				group: 'You',
				kind: 'text',
				label: 'Name',
				value: 'Ada',
				required: true,
				maxLength: 40,
			},
			{
				id: 'seats',
				rev: '2-t2',
				kind: 'number',
				label: 'Seats',
				description: 'Up to four',
				value: 1,
				min: 1,
				max: 4,
			},
			{
				id: 'when',
				rev: '3-t3',
				kind: 'text',
				label: 'Date',
				value: '',
				format: 'date',
				error: 'Pick a date',
			},
		]);
	});

	it('lists a secret without its value, error or rev', async () => {
		const f = form({ pin: { label: 'PIN', value: '4417', secret: true, error: 'Four digits' } });

		expect((await f.list()).controls).toEqual([
			{ id: 'pin', kind: 'text', label: 'PIN', secret: true },
		]);
	});

	it('lists choices for ten or fewer and counts them otherwise', async () => {
		const many = Array.from({ length: 11 }, (_, index) => ({
			value: `v${index}`,
			label: `L${index}`,
		}));
		const f = form({
			few: { kind: 'choice', value: 'morning', choices: SESSIONS },
			many: { kind: 'choices', value: [], choices: many },
			none: { kind: 'choice', value: '' },
		});

		const [few, more, none] = (await f.list()).controls;

		expect(few?.choices).toEqual(SESSIONS);
		expect(few).not.toHaveProperty('choiceCount');
		expect(more?.choiceCount).toBe(11);
		expect(more).not.toHaveProperty('choices');
		expect(none?.choices).toEqual([]);
	});

	it('answers a screen with nothing bound empty whatever group is asked, and says why', async () => {
		const f = form({});
		f.registry.setScreen({ name: 'Welcome' });

		const result = await f.run<ControlListResult>('control-list', { group: 'Payment' });

		expect(result.success).toBe(true);
		expect(result.data).toEqual({ screen: 'Welcome', controls: [], total: 0, more: 0 });
		expect(result.reasoning).toBe('The application has bound no controls on this screen.');
	});

	it('refuses a group no control has', async () => {
		const f = form({ name: { group: 'You' } });

		const result = await f.run('control-list', { group: 'Billing' });

		expect(result.error).toEqual({
			code: 'NOT_FOUND',
			message: 'No group "Billing" on this screen',
			suggestion: 'Use control-list with no group to see every control and its group',
			recovery: { kind: 'call', command: 'control-list' },
		});
		expect(recoveryIsReadable(result)).toBe(true);
	});

	it('pages with offset and limit, total counting after group and more counting the rest', async () => {
		const f = form(
			Object.fromEntries(
				Array.from({ length: 7 }, (_, index) => [`c${index}`, { group: index < 5 ? 'A' : 'B' }])
			)
		);

		const page = await f.run<ControlListResult>('control-list', {
			group: 'A',
			offset: 1,
			limit: 2,
		});
		const last = await f.run<ControlListResult>('control-list', {
			group: 'A',
			offset: 4,
			limit: 2,
		});
		const past = await f.run<ControlListResult>('control-list', { offset: 7 });
		const defaults = await f.run<ControlListResult>('control-list', {});

		expect(page.data?.controls.map((control) => control.id)).toEqual(['c1', 'c2']);
		expect(page.data).toMatchObject({ total: 5, more: 2 });
		expect(last.data).toMatchObject({ total: 5, more: 0, controls: [{ id: 'c4' }] });
		expect(past.data).toMatchObject({ total: 7, more: 0, controls: [] });
		expect(defaults.data).toMatchObject({ total: 7, more: 0 });
	});

	it('refuses a limit or offset outside its range', async () => {
		const f = form({ name: {} });
		for (const input of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { limit: 1.5 }]) {
			expect((await f.run('control-list', input)).error?.code).toBe('VALIDATION_ERROR');
		}
	});

	it('ends a page early at the output budget, with more counting the rest', async () => {
		const f = form(
			Object.fromEntries(
				Array.from({ length: 30 }, (_, index) => [
					`control-${index}`,
					{ label: `A control with a longer label, number ${index}`, value: 'x'.repeat(40) },
				])
			)
		);

		const first = await f.run<ControlListResult>('control-list', {}, 'agent', {
			outputBudget: { maxBytes: 2000 },
		});
		const returned = first.data?.controls.length as number;
		const report = first.metadata?.['dev.afd/outputBudget'] as {
			limitBytes: number;
			usedBytes: number;
		};
		const rest = await f.run<ControlListResult>('control-list', { offset: returned }, 'agent', {
			outputBudget: { maxBytes: 65536 },
		});

		expect(first.success).toBe(true);
		expect(returned).toBeGreaterThan(1);
		expect(returned).toBeLessThan(30);
		expect(first.data?.more).toBe(30 - returned);
		expect(report.usedBytes).toBeLessThanOrEqual(2000);
		expect(rest.data?.controls).toHaveLength(30 - returned);
		expect(rest.data?.more).toBe(0);
	});

	it('always holds its first control, and ends only at limit with no budget', async () => {
		const f = form({ a: { value: 'x'.repeat(100) }, b: {}, c: {} });
		const list = commandNamed(f.commands, 'control-list');

		const tight = await list.handler({ limit: 50, offset: 0 }, { outputBudget: 10 });
		const unbounded = await list.handler({ limit: 2, offset: 0 }, {});

		expect((tight.data as ControlListResult).controls.map((control) => control.id)).toEqual(['a']);
		expect((tight.data as ControlListResult).more).toBe(2);
		expect((unbounded.data as ControlListResult).controls).toHaveLength(2);
		expect((unbounded.data as ControlListResult).more).toBe(1);
	});
});

// ─── control-set ─────────────────────────────────────────────────────────────

describe('control-set', () => {
	it('reports what each control held, holds and shows, and how to undo it', async () => {
		const f = form({
			name: { required: true },
			email: { format: 'email', required: true },
			diet: {
				kind: 'choices',
				value: ['vegan'],
				choices: [
					{ value: 'vegan', label: 'Vegan' },
					{ value: 'halal', label: 'Halal' },
				],
			},
		});
		f.onWrite.set('name', (value) => {
			f.state('name').error = value === 'X' ? 'Too short' : undefined;
		});
		const revs = await f.revs();

		const result = await f.set([
			{ id: 'name', value: 'X', rev: revs.name as string },
			{ id: 'diet', value: ['Vegan'], rev: revs.diet as string },
		]);

		expect(result.data?.changed).toEqual([
			{ id: 'name', value: 'X', previous: '', rev: expect.any(String), error: 'Too short' },
		]);
		expect(result.data?.changed[0]?.rev).not.toBe(revs.name);
		expect(result.data?.unchanged).toEqual(['diet']);
		expect(result.data?.missing).toEqual(['email']);
		expect(result.undoCommand).toBe('control-restore');
		expect(result.undoArgs).toEqual({
			controls: [{ id: 'name', rev: result.data?.changed[0]?.rev }],
		});
	});

	it('compares a list of choices without regard to order, and carries no undo when nothing changed', async () => {
		const f = form({
			diet: {
				kind: 'choices',
				value: ['a', 'b'],
				choices: [
					{ value: 'a', label: 'A' },
					{ value: 'b', label: 'B' },
				],
			},
		});
		const revs = await f.revs();

		const result = await f.set([{ id: 'diet', value: ['b', 'a'], rev: revs.diet as string }]);

		expect(result.data).toMatchObject({ changed: [], unchanged: ['diet'] });
		expect(result).not.toHaveProperty('undoCommand');
		expect(f.writes).toEqual([]);
	});

	it('writes the value a choice resolves to', async () => {
		const f = form({ session: { kind: 'choice', value: 'morning', choices: SESSIONS } });
		const revs = await f.revs();

		await f.set([{ id: 'session', value: 'EVENING', rev: revs.session as string }]);

		expect(f.writes).toEqual([['session', 'evening']]);
	});

	describe('refuses a caller that is a person', () => {
		it('with FORBIDDEN, before any entry, writing nothing', async () => {
			const f = form({ name: {} });
			const revs = await f.revs();

			const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }], 'human');

			expect(result.error).toEqual({
				code: 'FORBIDDEN',
				message: "control-set is an agent's command",
				suggestion:
					"Create the client with actor { kind: 'agent' }; a person changes the controls themselves",
				recovery: { kind: 'external' },
			});
			expect(recoveryIsReadable(result)).toBe(true);
			expect(f.writes).toEqual([]);
		});

		it.each(['agent', 'test', 'service', 'script', undefined] as const)(
			'and not an actor of kind %s',
			async (actor) => {
				const f = form({ name: {} });
				const revs = await f.revs();
				const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }], actor);
				expect(result.success).toBe(true);
			}
		);
	});

	describe('checks each entry, stopping at its first failing check', () => {
		const controls: Record<string, Partial<ControlState>> = {
			name: { label: 'Full name' },
			pin: { label: 'Card PIN', secret: true },
			voucher: { label: 'Voucher code', disabled: true },
			member: { label: 'Member number', readOnly: true },
			gift: { label: 'Gift message', hidden: true },
			seats: { kind: 'number', label: 'Seats', value: 1, min: 1, max: 4 },
		};

		it.each([
			[
				'1, not registered',
				[{ id: 'gone', value: 'x' }],
				'NOT_FOUND',
				'1 of 1 values refused: gone: is not on this screen',
				'Use control-list to read the controls on this screen',
				{ kind: 'call', command: 'control-list' },
			],
			[
				'2, a secret, whatever rev is sent',
				[{ id: 'pin', value: '0000', rev: 'none' }],
				'FORBIDDEN',
				'1 of 1 values refused: pin: Card PIN is a secret',
				'Ask the person to enter it themselves',
				{ kind: 'external' },
			],
			[
				'3, an id sent more than once',
				[
					{ id: 'name', value: 'Ada' },
					{ id: 'name', value: 'Grace' },
				],
				'VALIDATION_ERROR',
				'1 of 2 values refused: name: is sent more than once',
				'Send each control once',
				{ kind: 'fix-input', needs: ['values'] },
			],
			[
				'4, disabled',
				[{ id: 'voucher', value: 'SPRING' }],
				'CONFLICT',
				'1 of 1 values refused: voucher: Voucher code is disabled',
				'Voucher code is disabled, so the person cannot change it either',
				{ kind: 'stop' },
			],
			[
				'5, read-only',
				[{ id: 'member', value: 'M-1' }],
				'CONFLICT',
				'1 of 1 values refused: member: Member number is read-only',
				'Member number is read-only, so the person cannot change it either',
				{ kind: 'stop' },
			],
			[
				'6, not shown',
				[{ id: 'gift', value: 'Hi' }],
				'CONFLICT',
				'1 of 1 values refused: gift: Gift message is not shown',
				'Gift message is not shown to the person. Ask them to open that part of the screen',
				{ kind: 'external' },
			],
			[
				'7, a rev that is not its own',
				[{ id: 'name', value: 'Ada', rev: 'r-9999' }],
				'CONFLICT',
				'1 of 1 values refused: name: has changed since it was read',
				'Use control-list to read it again, and keep what the person entered unless they ask otherwise',
				{ kind: 'call', command: 'control-list' },
			],
			[
				'8, a value it does not take',
				[{ id: 'seats', value: 9 }],
				'VALIDATION_ERROR',
				'1 of 1 values refused: seats: is not between 1 and 4',
				'Send a number between 1 and 4',
				{ kind: 'fix-input', needs: ['values'] },
			],
		] as const)('check %s', async (_check, entries, code, message, suggestion, recovery) => {
			const f = form(controls);
			const revs = await f.revs();
			const result = await f.set(
				entries.map((entry) => ({
					id: entry.id,
					value: entry.value,
					rev: 'rev' in entry ? entry.rev : (revs[entry.id] ?? 'none'),
				}))
			);

			expect(result.error).toMatchObject({ code, message, suggestion, recovery });
			expect(result.error).not.toHaveProperty('retryable');
			expect(recoveryIsReadable(result)).toBe(true);
			expect(f.writes).toEqual([]);
		});

		it('in the order of section 5.1 when several fail for one entry', async () => {
			const f = form({
				both: { label: 'Both', secret: true, disabled: true },
				locked: { label: 'Locked', disabled: true, readOnly: true, hidden: true },
				shut: { label: 'Shut', hidden: true, kind: 'number', value: 1 },
				stale: { kind: 'number', value: 1, max: 2 },
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'both', value: 'x', rev: 'none' },
				{ id: 'both', value: 'x', rev: 'none' },
				{ id: 'locked', value: 'x', rev: 'none' },
				{ id: 'shut', value: 'text', rev: 'none' },
				{ id: 'stale', value: 9, rev: 'none' },
				{ id: 'stale', value: 9, rev: revs.stale as string },
			]);

			expect(result.error?.details?.refused).toEqual([
				{ id: 'both', code: 'FORBIDDEN', reason: 'Both is a secret' },
				{ id: 'both', code: 'FORBIDDEN', reason: 'Both is a secret' },
				{ id: 'locked', code: 'CONFLICT', reason: 'Locked is disabled' },
				{ id: 'shut', code: 'CONFLICT', reason: 'Shut is not shown' },
				{ id: 'stale', code: 'CONFLICT', reason: 'has changed since it was read' },
				{ id: 'stale', code: 'VALIDATION_ERROR', reason: 'is sent more than once' },
			]);
		});

		it("lists every refused entry in details, and gives the first one's error", async () => {
			const f = form(controls);
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'name', value: 'Ada', rev: revs.name as string },
				{ id: 'seats', value: 0, rev: revs.seats as string },
				{ id: 'voucher', value: 'SPRING', rev: revs.voucher as string },
				{ id: 'gone', value: 'x', rev: 'none' },
			]);

			expect(result.error?.code).toBe('VALIDATION_ERROR');
			expect(result.error?.message).toBe('3 of 4 values refused: seats: is not between 1 and 4');
			expect(result.error?.details).toEqual({
				refused: [
					{ id: 'seats', code: 'VALIDATION_ERROR', reason: 'is not between 1 and 4' },
					{ id: 'voucher', code: 'CONFLICT', reason: 'Voucher code is disabled' },
					{ id: 'gone', code: 'NOT_FOUND', reason: 'is not on this screen' },
				],
			});
			expect(recoveryIsReadable(result)).toBe(true);
			expect(f.values()).toMatchObject({ name: '', seats: 1 });
		});

		it('names control-choices with the call that searches a long list', async () => {
			const many = Array.from({ length: 12 }, (_, index) => ({
				value: `v${index}`,
				label: `L${index}`,
			}));
			const f = form({ country: { kind: 'choice', value: '', label: 'Country', choices: many } });
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'country', value: 'Atlantis', rev: revs.country as string },
			]);

			expect(result.error).toMatchObject({
				message: '1 of 1 values refused: country: is not one of its choices',
				suggestion: 'Use control-choices to search its 12 choices',
				recovery: { kind: 'call', command: 'control-choices', input: { id: 'country' } },
			});
			expect(recoveryIsReadable(result)).toBe(true);
		});
	});

	describe('an entry an earlier entry of the call moved', () => {
		function booking() {
			const f = form({
				session: { kind: 'choice', value: 'morning', choices: SESSIONS },
				seats: { kind: 'number', value: 1, min: 1, max: 4 },
				notes: {},
			});
			f.onWrite.set('session', (value) => {
				f.state('seats').max = value === 'evening' ? 2 : 4;
			});
			return f;
		}

		it('is refused when its limit moved, and the earlier one is put back', async () => {
			const f = booking();
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'session', value: 'evening', rev: revs.session as string },
				{ id: 'seats', value: 3, rev: revs.seats as string },
			]);

			expect(result.error).toMatchObject({
				code: 'VALIDATION_ERROR',
				message: '1 of 2 values refused: seats: is not between 1 and 2',
				suggestion: 'Send a number between 1 and 2',
				details: {
					refused: [{ id: 'seats', code: 'VALIDATION_ERROR', reason: 'is not between 1 and 2' }],
				},
			});
			expect(f.writes).toEqual([
				['session', 'evening'],
				['session', 'morning'],
			]);
			expect(f.values()).toMatchObject({ session: 'morning', seats: 1 });
			expect(f.state('seats').max).toBe(4);
		});

		it('is refused when it became disabled', async () => {
			const f = booking();
			f.onWrite.set('notes', (value) => {
				if (value !== '') f.state('seats').disabled = true;
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'notes', value: 'hi', rev: revs.notes as string },
				{ id: 'seats', value: 2, rev: revs.seats as string },
			]);

			expect(result.error?.message).toBe('1 of 2 values refused: seats: seats is disabled');
			expect(result.error?.code).toBe('CONFLICT');
			expect(f.state('notes').value).toBe('');
		});

		it('is refused when it left the screen', async () => {
			const f = booking();
			f.onWrite.set('notes', (value) => {
				if (value !== '') f.registry.unregister('session');
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'notes', value: 'hi', rev: revs.notes as string },
				{ id: 'session', value: 'evening', rev: revs.session as string },
			]);

			expect(result.error?.message).toBe('1 of 2 values refused: session: is not on this screen');
			expect(result.error?.code).toBe('NOT_FOUND');
			expect(f.state('notes').value).toBe('');
		});

		it('is decided unchanged again, and still checked when it was unchanged', async () => {
			const f = booking();
			f.onWrite.set('notes', (value) => {
				if (value === 'two') f.state('seats').value = 2;
				if (value === 'max') f.state('seats').max = 1;
			});
			const revs = await f.revs();

			const nowSame = await f.set([
				{ id: 'notes', value: 'two', rev: revs.notes as string },
				{ id: 'seats', value: 2, rev: revs.seats as string },
			]);
			const moved = await f.revs();
			const wasSame = await f.set([
				{ id: 'notes', value: 'max', rev: moved.notes as string },
				{ id: 'seats', value: 2, rev: moved.seats as string },
			]);

			expect(nowSame.data?.changed.map((change) => change.id)).toEqual(['notes']);
			expect(nowSame.data?.unchanged).toEqual(['seats']);
			expect(nowSame.data?.affected.map((control) => control.id)).toEqual(['seats']);
			expect(wasSame.error?.message).toBe('1 of 2 values refused: seats: is not between 1 and 1');
			expect(f.state('notes').value).toBe('two');
		});

		it('is refused as changed when an earlier write bound another control under its id', async () => {
			const f = booking();
			f.onWrite.set('notes', (value) => {
				if (value === '') return;
				f.registry.unregister('seats');
				f.state('seats').max = 2;
				f.bind('seats');
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'notes', value: 'hi', rev: revs.notes as string },
				{ id: 'seats', value: 3, rev: revs.seats as string },
			]);

			// The caller read another control: check 7 comes before the value.
			expect(result.error?.code).toBe('CONFLICT');
			expect(result.error?.message).toBe(
				'1 of 2 values refused: seats: has changed since it was read'
			);
			expect(f.state('notes').value).toBe('');
		});

		it('lists nowhere a control a later write made a secret', async () => {
			const f = form({ a: { error: 'Shown' }, b: {} });
			f.onWrite.set('b', () => {
				f.state('a').secret = true;
				f.state('a').value = 'TOP-SECRET-9999';
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'a', value: 'x', rev: revs.a as string },
				{ id: 'b', value: 'y', rev: revs.b as string },
			]);

			expect(result.success).toBe(true);
			expect(result.data?.changed.map((change) => change.id)).toEqual(['b']);
			expect(result.data?.affected).toEqual([]);
			expect(result.undoArgs).toEqual({ controls: [{ id: 'b', rev: expect.any(String) }] });
			expect(JSON.stringify(result)).not.toContain('TOP-SECRET-9999');
			expect(JSON.stringify(result)).not.toContain('Shown');
		});

		it('names what could not be put back when the refusal comes after a write', async () => {
			const f = booking();
			f.onWrite.set('session', (value) => {
				if (value === 'morning') throw new Error('locked');
				f.state('seats').max = 2;
			});
			const revs = await f.revs();

			const result = await f.set([
				{ id: 'session', value: 'evening', rev: revs.session as string },
				{ id: 'seats', value: 3, rev: revs.seats as string },
			]);

			expect(result.error?.message).toBe(
				'1 of 2 values refused: seats: is not between 1 and 2; session could not be put back'
			);
		});
	});

	describe('a write that throws', () => {
		function three() {
			const f = form({ a: {}, b: {}, c: {} });
			return f;
		}

		it('on the second of three entries leaves all three as they were', async () => {
			const f = three();
			f.onWrite.set('b', () => {
				throw new Error('the element is gone');
			});
			const revs = await f.revs();

			const result = await f.set(
				['a', 'b', 'c'].map((id) => ({ id, value: `new ${id}`, rev: revs[id] as string }))
			);

			expect(result.error).toEqual({
				code: 'INTERNAL_ERROR',
				message: 'b could not be written: the element is gone',
				suggestion: 'Nothing was changed. Use control-list to read the screen',
				retryable: false,
				recovery: { kind: 'call', command: 'control-list' },
			});
			expect(recoveryIsReadable(result)).toBe(true);
			expect(f.values()).toEqual({ a: '', b: '', c: '' });
			expect(f.writes).toEqual([
				['a', 'new a'],
				['b', 'new b'],
				['a', ''],
			]);
		});

		it('says which could not be put back when writing one back throws too', async () => {
			const f = form({ a: {}, b: {}, c: {} });
			f.onWrite.set('a', (value) => {
				if (value === '') throw new Error('stuck');
			});
			f.onWrite.set('b', (value) => {
				if (value === '') throw new Error('stuck');
			});
			f.onWrite.set('c', () => {
				throw new Error('the element is gone');
			});
			const revs = await f.revs();

			const result = await f.set(
				['a', 'b', 'c'].map((id) => ({ id, value: `new ${id}`, rev: revs[id] as string }))
			);

			expect(result.error).toMatchObject({
				code: 'INTERNAL_ERROR',
				message: 'c could not be written: the element is gone; a, b could not be put back',
				suggestion: 'Use control-list to read the screen',
				retryable: false,
			});
		});
	});
});

// ─── A read that throws ──────────────────────────────────────────────────────

describe('a read that throws', () => {
	const readError = {
		code: 'INTERNAL_ERROR',
		message: 'name could not be read: the element is gone',
		suggestion: 'Tell the person this screen could not be read',
		retryable: false,
		recovery: { kind: 'stop' },
	};

	it('is INTERNAL_ERROR from each of the four commands', async () => {
		const f = form({ name: { kind: 'choice', value: '', choices: SESSIONS } });
		const revs = await f.revs();
		f.failRead.add('name');

		const results = [
			await f.run('control-list', {}),
			await f.set([{ id: 'name', value: 'morning', rev: revs.name as string }]),
			await f.restore([{ id: 'name', rev: revs.name as string }]),
			await f.run('control-choices', { id: 'name' }),
		];

		for (const result of results) {
			expect(result.error).toEqual(readError);
			expect(recoveryIsReadable(result)).toBe(true);
		}
	});

	it('after a write, puts back what the call wrote first', async () => {
		const f = form({ name: {}, other: {} });
		f.onWrite.set('name', (value) => {
			if (value !== '') f.failRead.add('other');
		});
		const revs = await f.revs();

		const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }]);

		expect(result.error).toMatchObject({
			code: 'INTERNAL_ERROR',
			message: 'other could not be read: the element is gone',
		});
		expect(f.state('name').value).toBe('');
	});

	it('mid-call, puts back what the call wrote and names what could not be put back', async () => {
		const f = form({ a: {}, b: {} });
		f.onWrite.set('a', (value) => {
			if (value === '') throw new Error('stuck');
			f.failRead.add('b');
		});
		const revs = await f.revs();

		const result = await f.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.error?.message).toBe(
			'b could not be read: the element is gone; a could not be put back'
		);
		expect(f.state('b').value).toBe('');
	});
});

// ─── affected and missing ────────────────────────────────────────────────────

describe('affected and missing', () => {
	it('carry the controls the write moved, as control-list gives them, and the required ones still empty', async () => {
		const f = form({
			session: { kind: 'choice', value: 'morning', choices: SESSIONS },
			seats: { kind: 'number', value: 1, min: 1, max: 4 },
			name: { required: true },
			diet: { kind: 'choices', value: [], required: true },
		});
		f.onWrite.set('session', (value) => {
			f.state('seats').max = value === 'evening' ? 2 : 4;
		});
		const revs = await f.revs();

		const result = await f.set([{ id: 'session', value: 'evening', rev: revs.session as string }]);
		const listed = (await f.list()).controls.find((control) => control.id === 'seats');

		expect(result.data?.affected).toEqual([listed]);
		expect(listed?.max).toBe(2);
		expect(result.data?.missing).toEqual(['name', 'diet']);
	});

	it('leave out a control a person changed before the call', async () => {
		const f = form({ name: {}, notes: {} });
		const revs = await f.revs();
		f.state('notes').value = 'typed by the person';

		const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }]);

		expect(result.success).toBe(true);
		expect(result.data?.affected).toEqual([]);
	});

	it('never carry a secret, even one that changed during the call', async () => {
		const f = form({
			name: {},
			pin: { secret: true, required: true, value: '4417' },
		});
		f.onWrite.set('name', () => {
			f.state('pin').value = '';
		});
		const revs = await f.revs();

		const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }]);

		expect(f.state('pin').value).toBe('');
		expect(result.data?.affected).toEqual([]);
		expect(result.data?.missing).toEqual([]);
	});
});

// ─── control-restore ─────────────────────────────────────────────────────────

describe('control-restore', () => {
	async function filled(controls: Record<string, Partial<ControlState>> = { a: {}, b: {} }) {
		const f = form(controls);
		const revs = await f.revs();
		const ids = Object.keys(controls);
		const set = await f.set(ids.map((id) => ({ id, value: `new ${id}`, rev: revs[id] as string })));
		const setRevs = Object.fromEntries(
			(set.data?.changed ?? []).map((change) => [change.id, change.rev])
		) as Record<string, string>;
		return { f, set, setRevs };
	}

	it("takes control-set's undoArgs as they are, and puts back what the controls held", async () => {
		const { f, set } = await filled();

		const result = await f.run<ControlRestoreResult>(
			set.undoCommand as string,
			set.undoArgs as Record<string, unknown>
		);

		// undoArgs list the controls backwards, so the last written is the first put back.
		expect(result.success).toBe(true);
		expect(result.data?.restored).toEqual([
			{ id: 'b', value: '', rev: expect.any(String) },
			{ id: 'a', value: '', rev: expect.any(String) },
		]);
		expect(result.data?.skipped).toEqual([]);
		expect(f.values()).toEqual({ a: '', b: '' });
	});

	it('may be called by a person', async () => {
		const { f, setRevs } = await filled();

		const result = await f.restore([{ id: 'a', rev: setRevs.a as string }], 'human');

		expect(result.data?.restored.map((entry) => entry.id)).toEqual(['a']);
	});

	it('restores nothing a second time, and its result carries no undoCommand', async () => {
		const { f, set } = await filled();
		const undo = set.undoArgs as Record<string, unknown>;

		const first = await f.run<ControlRestoreResult>('control-restore', undo);
		const second = await f.run<ControlRestoreResult>('control-restore', undo);

		expect(first).not.toHaveProperty('undoCommand');
		expect(first).not.toHaveProperty('undoArgs');
		expect(second.success).toBe(true);
		expect(second.data?.restored).toEqual([]);
		expect(second.data?.skipped).toEqual([
			{ id: 'b', reason: 'changed' },
			{ id: 'a', reason: 'changed' },
		]);
	});

	it('restores nothing for a rev read after the control value changed', async () => {
		const { f } = await filled({ a: {} });
		f.state('a').value = 'typed by the person';
		const revs = await f.revs();

		const result = await f.restore([{ id: 'a', rev: revs.a as string }]);

		expect(result.data?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
		expect(f.state('a').value).toBe('typed by the person');
	});

	it('restores nothing for a control whose value changed after the fill, whatever rev is sent', async () => {
		const { f, setRevs } = await filled({ a: {} });
		f.state('a').value = 'typed by the person';

		const result = await f.restore([{ id: 'a', rev: setRevs.a as string }]);

		expect(result.data?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
	});

	it('still restores a control whose error or limits changed after the fill', async () => {
		const { f, setRevs } = await filled({ a: { maxLength: 10 } });
		f.state('a').error = 'Checked later';
		f.state('a').maxLength = 0;

		const result = await f.restore([{ id: 'a', rev: setRevs.a as string }]);

		expect(result.data?.restored.map((entry) => entry.id)).toEqual(['a']);
		expect(f.state('a').value).toBe('');
	});

	it.each([
		['not-on-screen', (f: ReturnType<typeof form>) => f.registry.unregister('a')],
		[
			'secret',
			(f: ReturnType<typeof form>) => {
				f.state('a').secret = true;
			},
		],
		[
			'changed',
			(f: ReturnType<typeof form>) => {
				f.state('a').value = 'person';
			},
		],
		[
			'not-editable',
			(f: ReturnType<typeof form>) => {
				f.state('a').disabled = true;
			},
		],
		[
			'not-editable',
			(f: ReturnType<typeof form>) => {
				f.state('a').readOnly = true;
			},
		],
		[
			'not-shown',
			(f: ReturnType<typeof form>) => {
				f.state('a').hidden = true;
			},
		],
	] as const)('skips a control as %s', async (reason, change) => {
		const { f, setRevs } = await filled({ a: {}, b: {} });
		change(f);

		const result = await f.restore([
			{ id: 'a', rev: setRevs.a as string },
			{ id: 'b', rev: setRevs.b as string },
		]);

		expect(result.success).toBe(true);
		expect(result.data?.skipped).toEqual([{ id: 'a', reason }]);
		expect(result.data?.restored.map((entry) => entry.id)).toEqual(['b']);
	});

	it.each([
		['secret before changed', { secret: true, value: 'person' }, 'secret'],
		['changed before not-editable', { disabled: true, value: 'person' }, 'changed'],
		['not-editable before not-shown', { readOnly: true, hidden: true }, 'not-editable'],
		['changed before not-shown', { hidden: true, value: 'person' }, 'changed'],
	] as const)(
		'skips in the order of section 6 when two hold: %s',
		async (_order, change, reason) => {
			const { f, setRevs } = await filled({ a: {} });
			Object.assign(f.state('a'), change);

			const result = await f.restore([{ id: 'a', rev: setRevs.a as string }]);

			expect(result.data?.skipped).toEqual([{ id: 'a', reason }]);
		}
	);

	it('skips an id the second time it is sent', async () => {
		const { f, setRevs } = await filled({ a: {} });

		const result = await f.restore([
			{ id: 'a', rev: setRevs.a as string },
			{ id: 'a', rev: setRevs.a as string },
		]);

		expect(result.data?.restored.map((entry) => entry.id)).toEqual(['a']);
		expect(result.data?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
		expect(f.writes.filter(([id]) => id === 'a')).toHaveLength(2);
	});

	it('skips a rev that is not the one the fill returned', async () => {
		const { f } = await filled({ a: {} });

		const result = await f.restore([{ id: 'a', rev: 'r-9999' }]);

		expect(result.data?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
	});

	it('writes back past the limits now set, last written first, and reports what a form then moved', async () => {
		const f = form({
			session: { kind: 'choice', value: 'morning', choices: SESSIONS },
			seats: { kind: 'number', value: 4, min: 1, max: 4 },
		});
		f.onWrite.set('session', (value) => {
			if (value === 'morning') f.state('seats').value = 1;
		});
		const revs = await f.revs();
		const set = await f.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 3, rev: revs.seats as string },
		]);
		f.state('seats').max = 3;

		const result = await f.run<ControlRestoreResult>(
			'control-restore',
			set.undoArgs as Record<string, unknown>
		);

		// 4 is past the new limit of 3 and is written all the same. Putting the session back then
		// resets the seats to 1, as this form does on any morning: the undo cannot stop a form
		// moving a control, and the answer gives what each control holds afterwards, not 4.
		expect(f.writes.slice(-2)).toEqual([
			['seats', 4],
			['session', 'morning'],
		]);
		expect(result.data?.restored).toEqual([
			{ id: 'seats', value: 1, rev: expect.any(String) },
			{ id: 'session', value: 'morning', rev: expect.any(String) },
		]);
	});

	it('carries affected and missing as control-set does', async () => {
		const { f, setRevs } = await filled({ a: { required: true }, b: {} });
		f.onWrite.set('a', () => {
			f.state('b').label = 'Moved';
		});

		const result = await f.restore([{ id: 'a', rev: setRevs.a as string }]);

		expect(result.data?.affected.map((control) => [control.id, control.label])).toEqual([
			['b', 'Moved'],
		]);
		expect(result.data?.missing).toEqual(['a']);
	});

	it('puts back what it wrote when a write throws, and forgets nothing', async () => {
		const { f, set } = await filled({ a: {}, b: {} });
		f.onWrite.set('b', () => {
			throw new Error('the element is gone');
		});

		const failed = await f.run('control-restore', set.undoArgs as Record<string, unknown>);
		f.onWrite.delete('b');
		const retried = await f.run<ControlRestoreResult>(
			'control-restore',
			set.undoArgs as Record<string, unknown>
		);

		expect(failed.error).toMatchObject({
			code: 'INTERNAL_ERROR',
			message: 'b could not be written: the element is gone',
			suggestion: 'Nothing was changed. Use control-list to read the screen',
		});
		expect(retried.data?.restored.map((entry) => entry.id)).toEqual(['b', 'a']);
		expect(f.values()).toEqual({ a: '', b: '' });
	});

	it('puts back what it wrote when a read throws after the writes', async () => {
		const { f, setRevs } = await filled({ a: {}, b: {} });
		f.onWrite.set('a', (value) => {
			if (value === '') f.failRead.add('b');
		});

		const result = await f.restore([{ id: 'a', rev: setRevs.a as string }]);

		expect(result.error?.message).toBe('b could not be read: the element is gone');
		expect(f.state('a').value).toBe('new a');
	});
});

// ─── control-choices ─────────────────────────────────────────────────────────

describe('control-choices', () => {
	const COUNTRIES = ['Brazil', 'Canada', 'North Macedonia', 'Norway', 'Peru'].map((label) => ({
		value: label.slice(0, 3).toLowerCase(),
		label,
	}));

	function countries() {
		return form({
			country: { kind: 'choice', value: '', choices: COUNTRIES },
			name: {},
			seats: { kind: 'number', value: 1 },
			news: { kind: 'boolean', value: false },
			pin: { secret: true },
		});
	}

	it('searches labels without regard to case, in the control order, and pages', async () => {
		const f = countries();

		const search = await f.run<ControlChoicesResult>('control-choices', {
			id: 'country',
			search: 'NOR',
		});
		const page = await f.run<ControlChoicesResult>('control-choices', {
			id: 'country',
			offset: 1,
			limit: 2,
		});
		const past = await f.run<ControlChoicesResult>('control-choices', { id: 'country', offset: 5 });
		const all = await f.run<ControlChoicesResult>('control-choices', { id: 'country' });

		expect(search.data).toEqual({
			id: 'country',
			choices: [COUNTRIES[2], COUNTRIES[3]],
			total: 2,
			more: 0,
		});
		expect(page.data).toMatchObject({ choices: [COUNTRIES[1], COUNTRIES[2]], total: 5, more: 2 });
		expect(past.data).toMatchObject({ choices: [], total: 5, more: 0 });
		expect(all.data).toMatchObject({ choices: COUNTRIES, total: 5, more: 0 });
	});

	it('refuses an id that is not registered', async () => {
		const f = countries();

		const result = await f.run('control-choices', { id: 'billing' });

		expect(result.error).toEqual({
			code: 'NOT_FOUND',
			message: 'billing is not on this screen',
			suggestion: 'Use control-list to read the controls on this screen',
			recovery: { kind: 'call', command: 'control-list' },
		});
		expect(recoveryIsReadable(result)).toBe(true);
	});

	it.each([
		['name', 'text'],
		['seats', 'a number'],
		['news', 'true or false'],
	])('refuses %s, which has no choices, naming control-set', async (id, takes) => {
		const f = countries();

		const result = await f.run('control-choices', { id });

		expect(result.error).toEqual({
			code: 'VALIDATION_ERROR',
			message: `${id} has no choices: it takes ${takes}`,
			suggestion: 'Use control-set to give it a value',
			recovery: { kind: 'call', command: 'control-set', needs: ['values'] },
		});
		expect(recoveryIsReadable(result)).toBe(true);
	});

	it('names no command to a person, or for a secret', async () => {
		const f = countries();

		const person = await f.run('control-choices', { id: 'name' }, 'human');
		const secret = await f.run('control-choices', { id: 'pin' });

		for (const result of [person, secret]) {
			expect(result.error).toMatchObject({
				code: 'VALIDATION_ERROR',
				suggestion: 'It has no choices to search',
				recovery: { kind: 'stop' },
			});
			expect(recoveryIsReadable(result)).toBe(true);
		}
		expect(secret.error?.message).toBe('pin has no choices: it takes text');
	});
});

// ─── A control that left the screen ──────────────────────────────────────────

describe('a control that left the screen between a read and a write', () => {
	it('is not on the screen', async () => {
		const f = form({ name: {} });
		const revs = await f.revs();
		f.registry.unregister('name');

		const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }]);

		expect(result.error?.code).toBe('NOT_FOUND');
	});

	it('bound again under the same name, has a new rev, and the old one is refused', async () => {
		const f = form({ name: {} });
		const revs = await f.revs();
		f.registry.unregister('name');
		f.bind('name');

		const again = await f.revs();
		const result = await f.set([{ id: 'name', value: 'Ada', rev: revs.name as string }]);

		expect(again.name).not.toBe(revs.name);
		expect(result.error?.code).toBe('CONFLICT');
		expect(f.state('name').value).toBe('');
	});
});

describe('recoveryIsReadable', () => {
	it('fails a recovery a reader drops', () => {
		expect(
			recoveryIsReadable({
				success: false,
				error: { code: 'X', message: 'x', recovery: { kind: 'fix-input' } },
			})
		).toBe(false);
	});
});

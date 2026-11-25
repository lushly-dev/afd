/**
 * @fileoverview What a call may not leak, corrupt or leave behind: values shared with a caller
 * or a handler, a secret seen through the revs of other controls, the registry's record after a
 * call that was written back, and a control that changes what it is during a call.
 */

import { createDirectRegistry, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { describe, expect, it } from 'vitest';
import {
	type ControlChoicesResult,
	type ControlListResult,
	type ControlRestoreResult,
	type ControlSetResult,
	createControlCommands,
} from './commands.js';
import { ControlRegistry } from './registry.js';
import type { ControlHandler, ControlState, ControlValue } from './types.js';

/** A registry over plain states. A write keeps the very value it is given, as a careless handler would. */
function screen(controls: Record<string, Partial<ControlState>>) {
	let tokens = 0;
	const registry = new ControlRegistry({ token: () => `t${++tokens}` });
	const states = new Map<string, ControlState>();
	const onWrite = new Map<string, (value: ControlValue) => void>();
	const state = (id: string) => states.get(id) as ControlState;
	const handler = (id: string): ControlHandler => ({
		read: () => structuredClone(state(id)),
		write(value) {
			onWrite.get(id)?.(value);
			state(id).value = value;
		},
	});
	for (const [id, partial] of Object.entries(controls)) {
		states.set(id, { kind: 'text', label: id, value: '', ...partial });
		registry.register(id, handler(id));
	}
	const direct = createDirectRegistry(createControlCommands(registry) as ZodCommandDefinition[]);
	const run = <T>(name: string, input: Record<string, unknown>) =>
		direct.execute<T>(name, input, { actor: { kind: 'agent' } });
	const list = async () =>
		(await run<ControlListResult>('control-list', { limit: 100 })).data as ControlListResult;
	const revs = async () =>
		Object.fromEntries((await list()).controls.map((control) => [control.id, control.rev]));
	const set = (values: Array<{ id: string; value: ControlValue; rev: string }>) =>
		run<ControlSetResult>('control-set', { values });
	const restore = (entries: Array<{ id: string; rev: string }>) =>
		run<ControlRestoreResult>('control-restore', { controls: entries });
	return { registry, states, state, onWrite, handler, run, list, revs, set, restore };
}

/** The controls of a result's `undoArgs`, as `control-restore` takes them. */
function undoOf(result: {
	undoArgs?: Record<string, unknown>;
}): Array<{ id: string; rev: string }> {
	const controls = result.undoArgs?.controls;
	if (!Array.isArray(controls)) throw new Error('The result has no undoArgs');
	return controls as Array<{ id: string; rev: string }>;
}

/** The list a result carries, itself and not a copy, so a test can change it as a caller could. */
function listOf(value: unknown): string[] {
	if (!Array.isArray(value)) throw new Error('Not a list');
	return value as string[];
}

const DIETS = [
	{ value: 'vegan', label: 'Vegan' },
	{ value: 'halal', label: 'Halal' },
	{ value: 'kosher', label: 'Kosher' },
];

const SESSIONS = [
	{ value: 'morning', label: 'Morning' },
	{ value: 'evening', label: 'Evening' },
];

/**
 * A session that, set to the evening, lowers the most seats to two and the seats with it, and
 * set back gives the seats what they held.
 */
function booking() {
	const s = screen({
		session: { kind: 'choice', value: 'morning', choices: SESSIONS },
		seats: { kind: 'number', value: 1, min: 1, max: 4 },
	});
	let daytime = 1;
	s.onWrite.set('session', (value) => {
		const seats = s.state('seats');
		if (value === 'evening') {
			daytime = seats.value as number;
			seats.value = Math.min(daytime, 2);
			seats.max = 2;
		} else {
			seats.value = daytime;
			seats.max = 4;
		}
	});
	return s;
}

describe('a value shares nothing with the registry', () => {
	it('a caller that changes `previous` does not choose what a restore writes', async () => {
		const s = screen({ diet: { kind: 'choices', value: [], choices: DIETS } });
		const result = await s.set([
			{ id: 'diet', value: ['vegan'], rev: (await s.revs()).diet as string },
		]);
		listOf(result.data?.changed[0]?.previous).push('not-a-choice');

		await s.restore(result.undoArgs?.controls as Array<{ id: string; rev: string }>);

		expect(s.state('diet').value).toEqual([]);
	});

	it('a caller that changes `value` does not hide what a person does next', async () => {
		const s = screen({ diet: { kind: 'choices', value: [], choices: DIETS } });
		const result = await s.set([
			{ id: 'diet', value: ['vegan'], rev: (await s.revs()).diet as string },
		]);
		const change = result.data?.changed[0];
		listOf(change?.value).push('halal');

		s.state('diet').value = ['vegan', 'halal']; // the person ticks the same choice

		expect((await s.revs()).diet).not.toBe(change?.rev);
		const undone = await s.restore([{ id: 'diet', rev: change?.rev as string }]);
		expect(undone.data?.skipped).toEqual([{ id: 'diet', reason: 'changed' }]);
		expect(s.state('diet').value).toEqual(['vegan', 'halal']);
	});

	it('a caller that changes a restored value does not hide what a person does next', async () => {
		const s = screen({ diet: { kind: 'choices', value: ['kosher'], choices: DIETS } });
		const filled = await s.set([
			{ id: 'diet', value: ['vegan'], rev: (await s.revs()).diet as string },
		]);
		const undone = await s.restore(filled.undoArgs?.controls as Array<{ id: string; rev: string }>);
		const restored = undone.data?.restored[0];
		listOf(restored?.value).push('halal');

		s.state('diet').value = ['kosher', 'halal'];

		expect((await s.revs()).diet).not.toBe(restored?.rev);
	});

	it('a handler that keeps the list it was written back does not share it with the registry', async () => {
		const s = screen({
			diet: { kind: 'choices', value: ['vegan'], choices: DIETS },
			notes: {},
		});
		s.onWrite.set('notes', () => {
			throw new Error('boom');
		});
		const revs = await s.revs();
		const refused = await s.set([
			{ id: 'diet', value: ['kosher'], rev: revs.diet as string },
			{ id: 'notes', value: 'x', rev: revs.notes as string },
		]);
		expect(refused.error?.code).toBe('INTERNAL_ERROR');
		expect(s.state('diet').value).toEqual(['vegan']);

		listOf(s.state('diet').value).push('halal'); // the person, in place

		expect((await s.revs()).diet).not.toBe(revs.diet);
	});

	it('a caller that changes a choice it was given changes no control', async () => {
		// The first read of a control is the one that stores its copy. The rev the next listing
		// gives is the same whether or not the caller changed what it was handed.
		async function revAfter(change: boolean) {
			const s = screen({ diet: { kind: 'choices', value: [], choices: DIETS } });
			const found = await s.run<ControlChoicesResult>('control-choices', { id: 'diet' });
			if (change) (found.data?.choices[0] as { label: string }).label = 'Changed';
			const [diet] = (await s.list()).controls;
			return { rev: diet?.rev, label: diet?.choices?.[0]?.label };
		}

		expect(await revAfter(true)).toEqual(await revAfter(false));
		expect((await revAfter(true)).label).toBe('Vegan');
	});
});

describe('a secret behind the revs of other controls', () => {
	/** Fill `notes` after the secret changed `changes` times, and give the rev that fill returned. */
	async function revAfter(changes: number) {
		const s = screen({ pin: { secret: true, value: '1' }, notes: {} });
		const revs = await s.revs();
		for (let n = 0; n < changes; n++) {
			s.state('pin').value = `${n}-typed`;
			await s.list();
		}
		const result = await s.set([{ id: 'notes', value: 'hi', rev: revs.notes as string }]);
		return result.data?.changed[0]?.rev;
	}

	it('the revs a caller is given are the same however often a secret changed', async () => {
		expect(await revAfter(2)).toBe(await revAfter(0));
	});

	it('a control gets a rev when it stops being a secret', async () => {
		const s = screen({ code: { secret: true, value: 'x' } });
		expect((await s.list()).controls[0]?.rev).toBeUndefined();

		s.state('code').secret = false;

		expect((await s.list()).controls[0]?.rev).toEqual(expect.any(String));
	});
});

describe('a call that is written back leaves the registry as it was', () => {
	it('the same revs work after a refusal that came after a write', async () => {
		const s = booking();
		const revs = await s.revs();
		const refused = await s.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 3, rev: revs.seats as string },
		]);
		expect(refused.error?.code).toBe('VALIDATION_ERROR');
		expect(s.state('session').value).toBe('morning');

		const retried = await s.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 2, rev: revs.seats as string },
		]);

		expect(retried.success).toBe(true);
		expect(retried.data?.changed.map((change) => change.id)).toEqual(['session', 'seats']);
		expect(await s.revs()).not.toEqual(revs);
	});

	it('an earlier fill can still be taken back after such a refusal', async () => {
		const s = booking();
		const first = await s.revs();
		const filled = await s.set([{ id: 'seats', value: 3, rev: first.seats as string }]);
		const revs = await s.revs();
		const refused = await s.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 4, rev: revs.seats as string },
		]);
		expect(refused.error?.message).toBe(
			'1 of 2 values refused: seats: has changed since it was read'
		);
		expect(s.state('seats').value).toBe(3);

		const undone = await s.restore(filled.undoArgs?.controls as Array<{ id: string; rev: string }>);

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['seats']);
		expect(s.state('seats').value).toBe(1);
	});

	it('a restore can be tried again after a read threw once it had written', async () => {
		const s = screen({ a: {}, b: {} });
		const filled = await s.set([{ id: 'a', value: 'x', rev: (await s.revs()).a as string }]);
		const undoArgs = filled.undoArgs?.controls as Array<{ id: string; rev: string }>;
		let broken = false;
		s.registry.unregister('b');
		s.registry.register('b', {
			read() {
				if (broken) throw new Error('the element is gone');
				return structuredClone(s.state('b'));
			},
			write() {},
		});
		s.onWrite.set('a', () => {
			broken = true;
		});

		const failed = await s.restore(undoArgs);
		expect(failed.error?.code).toBe('INTERNAL_ERROR');
		expect(s.state('a').value).toBe('x');

		broken = false;
		s.onWrite.delete('a');
		const undone = await s.restore(undoArgs);

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['a']);
		expect(s.state('a').value).toBe('');
	});

	it('a write that changed its control and then threw is put back too', async () => {
		const s = screen({ a: {}, b: {} });
		s.registry.unregister('b');
		s.registry.register('b', {
			read: () => structuredClone(s.state('b')),
			write(value) {
				s.state('b').value = value;
				throw new Error('boom');
			},
		});
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.error?.code).toBe('INTERNAL_ERROR');
		expect(result.error?.message).toBe('b could not be written: boom; b could not be put back');
		expect(s.state('a').value).toBe('');
	});

	it('a write that changed its control and threw once is put back, and nothing else is left changed', async () => {
		const s = screen({ a: {}, b: {} });
		let thrown = false;
		s.registry.unregister('b');
		s.registry.register('b', {
			read: () => structuredClone(s.state('b')),
			write(value) {
				s.state('b').value = value;
				if (!thrown) {
					thrown = true;
					throw new Error('boom');
				}
			},
		});
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.error?.message).toBe('b could not be written: boom');
		expect(result.error?.suggestion).toBe(
			'Nothing was changed. Use control-list to read the screen'
		);
		expect([s.state('a').value, s.state('b').value]).toEqual(['', '']);
		expect(await s.revs()).toEqual(revs);
	});

	it('a write that threw before it changed anything is not written back', async () => {
		const s = screen({ a: {}, b: {} });
		s.onWrite.set('b', () => {
			throw new Error('boom');
		});
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.error?.message).toBe('b could not be written: boom');
		expect(result.error?.suggestion).toBe(
			'Nothing was changed. Use control-list to read the screen'
		);
		expect(await s.revs()).toEqual(revs);
	});
});

describe('an entry an earlier one moved is checked as it was sent', () => {
	const cities = (...entries: Array<[string, string]>) =>
		entries.map(([value, label]) => ({ value, label }));

	function trip(after: Array<[string, string]>) {
		const s = screen({
			country: { kind: 'choice', value: 'us', choices: cities(['us', 'US'], ['uk', 'UK']) },
			city: { kind: 'choice', value: '', choices: cities(['', 'None'], ['lon', 'London']) },
		});
		s.onWrite.set('country', () => {
			s.state('city').choices = cities(['', 'None'], ...after);
		});
		return s;
	}

	it('a label is resolved against the choices the control has when it is written', async () => {
		const s = trip([
			['lon', 'Londonderry'],
			['ldn', 'London'],
		]);
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'country', value: 'uk', rev: revs.country as string },
			{ id: 'city', value: 'London', rev: revs.city as string },
		]);

		expect(result.success).toBe(true);
		expect(s.state('city').value).toBe('ldn');
	});

	it('a label two of the new choices share is refused, and the earlier entry put back', async () => {
		const s = trip([
			['a', 'London'],
			['b', 'London'],
		]);
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'country', value: 'uk', rev: revs.country as string },
			{ id: 'city', value: 'London', rev: revs.city as string },
		]);

		expect(result.error?.message).toBe('1 of 2 values refused: city: matches more than one choice');
		expect(s.state('country').value).toBe('us');
		expect(s.state('city').value).toBe('');
	});
});

describe('an entry never replaces a value its caller did not read', () => {
	/** One address field that shows the home street or the work street, as `which` says. */
	function address() {
		const streets = { home: '', work: '12 Work Lane (typed by the person)' };
		let shown: keyof typeof streets = 'home';
		const s = screen({
			which: {
				kind: 'choice',
				value: 'home',
				choices: [
					{ value: 'home', label: 'Home' },
					{ value: 'work', label: 'Work' },
				],
			},
			street: {},
		});
		s.onWrite.set('which', (value) => {
			streets[shown] = s.state('street').value as string;
			shown = value as keyof typeof streets;
			s.state('street').value = streets[shown];
		});
		return { ...s, streets };
	}

	it('a value an earlier write of the call moved into place is not written over', async () => {
		const s = address();
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'which', value: 'work', rev: revs.which as string },
			{ id: 'street', value: '1 Agent Rd', rev: revs.street as string },
		]);

		expect(result.error?.code).toBe('CONFLICT');
		expect(result.error?.message).toBe(
			'1 of 2 values refused: street: has changed since it was read'
		);
		expect(result.error?.recovery).toEqual({ kind: 'call', command: 'control-list' });
		expect(s.state('which').value).toBe('home');
		expect(s.streets.work).toBe('12 Work Lane (typed by the person)');
	});

	it('the same holds when the earlier write bound another control under the id', async () => {
		const s = screen({ which: {}, street: {} });
		s.onWrite.set('which', (value) => {
			if (value === '') return;
			s.registry.unregister('street');
			s.states.set('street', { kind: 'text', label: 'street', value: 'typed by the person' });
			s.registry.register('street', s.handler('street'));
		});
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'which', value: 'work', rev: revs.which as string },
			{ id: 'street', value: '1 Agent Rd', rev: revs.street as string },
		]);

		expect(result.error?.message).toBe(
			'1 of 2 values refused: street: has changed since it was read'
		);
		expect(s.state('street').value).toBe('typed by the person');
	});

	it('a control that already holds what was sent is left as it is, whatever moved it', async () => {
		const s = address();
		s.streets.work = '1 Agent Rd';
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'which', value: 'work', rev: revs.which as string },
			{ id: 'street', value: '1 Agent Rd', rev: revs.street as string },
		]);

		expect(result.success).toBe(true);
		expect(result.data?.changed.map((change) => change.id)).toEqual(['which']);
		expect(result.data?.unchanged).toEqual(['street']);
	});

	it('a move that changes only what the control takes is checked again and written', async () => {
		const s = booking();
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 2, rev: revs.seats as string },
		]);

		expect(result.data?.changed.map((change) => change.id)).toEqual(['session', 'seats']);
	});
});

describe('an undo takes back the fill and nothing else', () => {
	/** One address field that shows the home street or the work street, as `which` says. */
	function address() {
		const streets = { home: '', work: '12 Work Lane (typed by the person)' };
		let shown: keyof typeof streets = 'home';
		const s = screen({
			street: {},
			which: {
				kind: 'choice',
				value: 'home',
				choices: [
					{ value: 'home', label: 'Home' },
					{ value: 'work', label: 'Work' },
				],
			},
		});
		s.onWrite.set('which', (value) => {
			streets[shown] = s.state('street').value as string;
			shown = value as keyof typeof streets;
			s.state('street').value = streets[shown];
		});
		const all = () => ({ ...streets, [shown]: s.state('street').value as string });
		return { ...s, all };
	}

	/** Fill the home street, then show the work street: the second write moves the first control. */
	async function filled() {
		const s = address();
		const revs = await s.revs();
		const fill = await s.set([
			{ id: 'street', value: '1 Agent Rd', rev: revs.street as string },
			{ id: 'which', value: 'work', rev: revs.which as string },
		]);
		const undoArgs = fill.undoArgs?.controls as Array<{ id: string; rev: string }>;
		return { s, undoArgs };
	}

	it("control-set's undoArgs, sent as they are, put every street back", async () => {
		const { s, undoArgs } = await filled();
		expect(undoArgs.map((entry) => entry.id)).toEqual(['which', 'street']);

		const undone = await s.restore(undoArgs);

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['which', 'street']);
		expect(s.all()).toEqual({ home: '', work: '12 Work Lane (typed by the person)' });
	});

	it('sent in the order written, they skip the control that holds another value now', async () => {
		const { s, undoArgs } = await filled();

		const undone = await s.restore([...undoArgs].reverse());

		expect(undone.data?.skipped).toEqual([{ id: 'street', reason: 'changed' }]);
		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['which']);
		expect(s.all().work).toBe('12 Work Lane (typed by the person)');
	});

	it('what was left undone can be taken back in a second call', async () => {
		const { s, undoArgs } = await filled();
		const [which, street] = undoArgs as [{ id: string; rev: string }, { id: string; rev: string }];

		await s.restore([which]);
		expect(s.all()).toEqual({ home: '1 Agent Rd', work: '12 Work Lane (typed by the person)' });
		const undone = await s.restore([street]);

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['street']);
		expect(s.all()).toEqual({ home: '', work: '12 Work Lane (typed by the person)' });
	});

	it('a fill whose control a second fill moved can be taken back after the second', async () => {
		const s = address();
		const first = await s.set([
			{ id: 'street', value: '1 Agent Rd', rev: (await s.revs()).street as string },
		]);
		const second = await s.set([
			{ id: 'which', value: 'work', rev: (await s.revs()).which as string },
		]);

		await s.restore(undoOf(second));
		const undone = await s.restore(undoOf(first));

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['street']);
		expect(s.all()).toEqual({ home: '', work: '12 Work Lane (typed by the person)' });
	});

	it('a person who changes a value and changes it back is not undone', async () => {
		const s = screen({ name: {} });
		const fill = await s.set([{ id: 'name', value: 'Ada', rev: (await s.revs()).name as string }]);

		s.state('name').value = 'Adam';
		await s.list(); // something looks at the screen while it holds the person's change
		s.state('name').value = 'Ada';
		const undone = await s.restore(undoOf(fill));

		expect(undone.data?.skipped).toEqual([{ id: 'name', reason: 'changed' }]);
		expect(s.state('name').value).toBe('Ada');
	});

	it('a control whose limits a restore of the same call moved is still put back', async () => {
		const s = screen({
			session: { kind: 'choice', value: 'morning', choices: SESSIONS },
			seats: { kind: 'number', value: 1, min: 1, max: 4 },
		});
		s.onWrite.set('session', (value) => {
			s.state('seats').max = value === 'evening' ? 2 : 4;
		});
		const revs = await s.revs();
		const fill = await s.set([
			{ id: 'session', value: 'evening', rev: revs.session as string },
			{ id: 'seats', value: 2, rev: revs.seats as string },
		]);
		const inOrderWritten = [...undoOf(fill)].reverse();

		// Putting the session back first moves the seats' limit, and so their rev, not their value.
		const undone = await s.restore(inOrderWritten);

		expect(undone.data?.skipped).toEqual([]);
		expect([s.state('session').value, s.state('seats').value]).toEqual(['morning', 1]);
	});
});

describe('a control that leaves the screen during a call', () => {
	it('is listed nowhere when a later write unregistered it', async () => {
		const s = screen({ a: {}, b: {} });
		s.onWrite.set('b', () => s.registry.unregister('a'));
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.data?.changed.map((change) => change.id)).toEqual(['b']);
		expect(result.undoArgs).toEqual({ controls: [{ id: 'b', rev: expect.any(String) }] });
	});

	it('is `affected` as what is now under its id when a later write bound another there', async () => {
		const s = screen({ a: {}, b: {} });
		s.onWrite.set('b', () => {
			s.registry.unregister('a');
			s.states.set('a', { kind: 'text', label: 'a', value: 'fresh' });
			s.registry.register('a', s.handler('a'));
		});
		const revs = await s.revs();

		const result = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);

		expect(result.data?.changed.map((change) => change.id)).toEqual(['b']);
		expect(result.data?.affected).toEqual([
			{ id: 'a', rev: expect.any(String), kind: 'text', label: 'a', value: 'fresh' },
		]);
		expect(result.data?.affected[0]?.rev).not.toBe(revs.a);
	});

	it('a restore lists nowhere a control its own write made a secret', async () => {
		const s = screen({ a: {}, b: {} });
		const revs = await s.revs();
		const filled = await s.set([
			{ id: 'a', value: 'x', rev: revs.a as string },
			{ id: 'b', value: 'y', rev: revs.b as string },
		]);
		s.onWrite.set('b', () => {
			s.state('a').secret = true;
			s.state('a').value = 'TOP-SECRET-9999';
		});

		const undone = await s.restore(filled.undoArgs?.controls as Array<{ id: string; rev: string }>);

		expect(undone.data?.restored.map((entry) => entry.id)).toEqual(['b']);
		expect(JSON.stringify(undone)).not.toContain('TOP-SECRET-9999');
	});
});

describe('a read that returns what is not a state', () => {
	it('is INTERNAL_ERROR, as a read that throws is', async () => {
		const registry = new ControlRegistry();
		registry.register('broken', {
			read: () => undefined as unknown as ControlState,
			write() {},
		});
		const direct = createDirectRegistry(createControlCommands(registry) as ZodCommandDefinition[]);

		const result = await direct.execute('control-list', {}, { actor: { kind: 'agent' } });

		expect(result.error?.code).toBe('INTERNAL_ERROR');
		expect(result.error?.message).toMatch(/^broken could not be read: /);
		expect(result.error?.recovery).toEqual({ kind: 'stop' });
	});

	/** What `control-list` answers on a screen whose one control reads as given. */
	function listed(id: string, read: unknown) {
		const registry = new ControlRegistry();
		registry.register(id, { read: () => read as ControlState, write() {} });
		const direct = createDirectRegistry(createControlCommands(registry) as ZodCommandDefinition[]);
		return direct.execute('control-list', {}, { actor: { kind: 'agent' } });
	}

	const noValue = 'its value is not text, a number, true or false, or a list of text';

	it.each([
		['no kind', {}, 'its kind is not one a control has'],
		[
			'a kind no control has',
			{ kind: 'slider', label: 'Volume', value: 3 },
			'its kind is not one a control has',
		],
		['a label that is not text', { kind: 'text', label: 5, value: '' }, 'its label is not text'],
		['no value', { kind: 'text', label: 'Name', value: null }, noValue],
		['a list that is not of text', { kind: 'choices', label: 'Days', value: [1] }, noValue],
		[
			'a description that is not text',
			{ kind: 'text', label: 'Name', value: '', description: 7 },
			'its description is not text',
		],
		[
			'a limit that is not a number',
			{ kind: 'number', label: 'Seats', value: 1, max: '4' },
			'its max is not a number',
		],
		[
			'a flag that is not true or false',
			{ kind: 'text', label: 'Name', value: '', disabled: 'no' },
			'its disabled is not true or false',
		],
		[
			'a format no control has',
			{ kind: 'text', label: 'Phone', value: '', format: 'phone' },
			'its format is not one a control has',
		],
		[
			'choices that are not values with labels',
			{ kind: 'choice', label: 'Session', value: '', choices: ['morning'] },
			'its choices are not a list of values with labels',
		],
		// biome-ignore lint/suspicious/noSparseArray: the gap is what is tested
		['a list with a gap', { kind: 'choices', label: 'Days', value: [, 'mon'] }, noValue],
		[
			'choices with a gap',
			// biome-ignore lint/suspicious/noSparseArray: the gap is what is tested
			{ kind: 'choice', label: 'Session', value: '', choices: [, { value: 'a', label: 'A' }] },
			'its choices are not a list of values with labels',
		],
		['nothing at all', null, 'its handler read no state'],
	])('a state with %s is INTERNAL_ERROR, naming the field', async (_what, read, reason) => {
		const result = await listed('broken', read);

		expect(result.success).toBe(false);
		expect(result.error).toMatchObject({
			code: 'INTERNAL_ERROR',
			message: `broken could not be read: ${reason}`,
			recovery: { kind: 'stop' },
		});
	});

	it('a secret flag that is not true or false is never read as false', async () => {
		const result = await listed('pin', {
			kind: 'text',
			label: 'PIN',
			value: 'TOP-SECRET-9999',
			secret: 1,
		});

		expect(result.error?.message).toBe('pin could not be read: its secret is not true or false');
		expect(JSON.stringify(result)).not.toContain('TOP-SECRET-9999');
	});

	it('a secret flag set to undefined is read as absent, as a false one is', async () => {
		const result = await listed('name', {
			kind: 'text',
			label: 'Name',
			value: 'Ada',
			secret: undefined,
			disabled: false,
		});

		expect(result.success).toBe(true);
	});

	it('a state with every field of its type is read', async () => {
		const result = await listed('session', {
			kind: 'choice',
			label: 'Session',
			value: 'morning',
			group: 'Booking',
			description: 'When to come',
			required: true,
			hidden: false,
			choices: [{ value: 'morning', label: 'Morning' }],
			error: '',
		});

		expect(result.success).toBe(true);
	});
});

describe('a page at the output budget holds all that fits', () => {
	it('one more control would have passed the budget', async () => {
		const controls = Object.fromEntries(
			Array.from({ length: 30 }, (_, n) => [`field-${n}`, { label: `Field number ${n}` }])
		);
		const s = screen(controls);
		const registry = createDirectRegistry(
			createControlCommands(s.registry) as ZodCommandDefinition[]
		);
		const budget = 2000;
		const bytes = (result: unknown) => {
			const { metadata: _metadata, ...measured } = result as Record<string, unknown>;
			return new TextEncoder().encode(JSON.stringify(measured)).length;
		};

		const page = await registry.execute<ControlListResult>(
			'control-list',
			{},
			{ actor: { kind: 'agent' } },
			{ outputBudget: { maxBytes: budget } }
		);
		const held = page.data?.controls.length as number;
		const oneMore = await registry.execute<ControlListResult>(
			'control-list',
			{ limit: held + 1 },
			{ actor: { kind: 'agent' } }
		);

		expect(held).toBeGreaterThan(1);
		expect(page.data?.more).toBe(30 - held);
		expect(bytes(page)).toBeLessThanOrEqual(budget);
		expect(oneMore.data?.controls.length).toBe(held + 1);
		expect(bytes(oneMore)).toBeGreaterThan(budget);
	});
});

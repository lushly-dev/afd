/**
 * @fileoverview The control registry (the specification's section 3): registering, the screen,
 * and the `rev` it issues.
 */

import { createDirectRegistry, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	type ControlListResult,
	type ControlSetResult,
	createControlCommands,
} from './commands.js';
import { ControlRegistry, controlStore } from './registry.js';
import type { ControlHandler, ControlState } from './types.js';

function textHandler(state: Partial<ControlState> = {}): ControlHandler & { state: ControlState } {
	const handler = {
		state: { kind: 'text', label: 'Name', value: '', ...state } as ControlState,
		read: () => ({ ...handler.state }),
		write: (value: ControlState['value']) => {
			handler.state.value = value;
		},
	};
	return handler;
}

function commandsOf(registry: ControlRegistry) {
	return createDirectRegistry(createControlCommands(registry) as ZodCommandDefinition[]);
}

const AGENT = { actor: { kind: 'agent' as const } };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('register', () => {
	it('throws for an id that is empty or already registered', () => {
		const registry = new ControlRegistry();
		registry.register('name', textHandler());

		expect(() => registry.register('', textHandler())).toThrow(/not empty/);
		expect(() => registry.register('name', textHandler())).toThrow(/already registered as "name"/);
	});

	it('lists ids in the order they were registered', async () => {
		const registry = new ControlRegistry();
		for (const id of ['c', 'a', 'b']) registry.register(id, textHandler());

		const result = await commandsOf(registry).execute<ControlListResult>('control-list', {});
		expect(result.data?.controls.map((control) => control.id)).toEqual(['c', 'a', 'b']);
	});

	it('has an id while it is registered', () => {
		const registry = new ControlRegistry();
		const unregister = registry.register('name', textHandler());

		expect(registry.has('name')).toBe(true);
		unregister();
		expect(registry.has('name')).toBe(false);
	});
});

describe('unregister', () => {
	it('does nothing for an id that is not registered', () => {
		const registry = new ControlRegistry();
		registry.register('name', textHandler());

		expect(() => registry.unregister('other')).not.toThrow();
		expect(registry.has('name')).toBe(true);
	});

	it('the function register returned does nothing after its id was registered again', () => {
		const registry = new ControlRegistry();
		const first = registry.register('name', textHandler());
		registry.unregister('name');
		const second = textHandler({ value: 'second' });
		registry.register('name', second);

		first();

		expect(registry.has('name')).toBe(true);
		expect(controlStore(registry).get('name')?.handler).toBe(second);
	});
});

describe('setScreen', () => {
	it('names the screen and its command, and replaces what was set before', async () => {
		const registry = new ControlRegistry();
		registry.register('name', textHandler());
		const commands = commandsOf(registry);

		registry.setScreen({ name: 'Book a seat', command: 'seat-book' });
		const first = await commands.execute<ControlListResult>('control-list', {});
		registry.setScreen({ name: 'Profile' });
		const second = await commands.execute<ControlListResult>('control-list', {});

		expect(first.data).toMatchObject({ screen: 'Book a seat', command: 'seat-book' });
		expect(second.data?.screen).toBe('Profile');
		expect(second.data).not.toHaveProperty('command');
	});
});

describe('a rev', () => {
	it('is made of the token the option issues', async () => {
		let count = 0;
		const registry = new ControlRegistry({ token: () => `t${++count}` });
		registry.register('name', textHandler());

		const result = await commandsOf(registry).execute<ControlListResult>('control-list', {});
		expect(result.data?.controls[0]?.rev).toBe('1-t1');
	});

	it('joins a counter to random bytes from crypto.getRandomValues by default', async () => {
		const random = vi.spyOn(globalThis.crypto, 'getRandomValues');
		const registry = new ControlRegistry();
		registry.register('name', textHandler());

		const result = await commandsOf(registry).execute<ControlListResult>('control-list', {});
		expect(random).toHaveBeenCalled();
		expect(result.data?.controls[0]?.rev).toMatch(/^1-[0-9a-f]{16}$/);
	});

	it('is never issued twice across ten thousand changes', async () => {
		const registry = new ControlRegistry({ token: () => 'same' });
		const handler = textHandler();
		registry.register('name', handler);
		const commands = commandsOf(registry);
		const revs = new Set<string>();

		for (let change = 0; change < 10_000; change++) {
			handler.state.value = `value ${change}`;
			const result = await commands.execute<ControlListResult>('control-list', {});
			revs.add(result.data?.controls[0]?.rev as string);
		}

		expect(revs.size).toBe(10_000);
	});

	it('stays the same while nothing about the control changes, a false flag the same as an absent one', async () => {
		const registry = new ControlRegistry();
		const handler = textHandler({ choices: undefined });
		registry.register('name', handler);
		const commands = commandsOf(registry);

		const first = await commands.execute<ControlListResult>('control-list', {});
		handler.state.disabled = false;
		handler.state.error = '';
		const second = await commands.execute<ControlListResult>('control-list', {});

		expect(second.data?.controls[0]?.rev).toBe(first.data?.controls[0]?.rev);
	});

	it('changes when any field changes, a list compared item by item', async () => {
		const registry = new ControlRegistry();
		const handler = textHandler({
			kind: 'choices',
			value: ['a'],
			choices: [
				{ value: 'a', label: 'A' },
				{ value: 'b', label: 'B' },
			],
		});
		registry.register('diet', handler);
		const commands = commandsOf(registry);
		const revOf = async () =>
			(await commands.execute<ControlListResult>('control-list', {})).data?.controls[0]?.rev;

		const revs = [await revOf()];
		handler.state.value = ['a', 'b'];
		revs.push(await revOf());
		handler.state.choices = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'Bee' },
		];
		revs.push(await revOf());
		handler.state.hidden = true;
		revs.push(await revOf());
		handler.state.label = 'Diet';
		revs.push(await revOf());

		expect(new Set(revs).size).toBe(5);
	});

	it('changes for a handler whose state changes without a command, and the old rev is refused', async () => {
		const registry = new ControlRegistry();
		const handler = textHandler();
		registry.register('name', handler);
		const commands = commandsOf(registry);
		const read = await commands.execute<ControlListResult>('control-list', {});
		const old = read.data?.controls[0]?.rev as string;

		handler.state.value = 'typed by the person';
		const next = await commands.execute<ControlListResult>('control-list', {});
		const refused = await commands.execute(
			'control-set',
			{
				values: [{ id: 'name', value: 'Ada', rev: old }],
			},
			AGENT
		);

		expect(next.data?.controls[0]?.rev).not.toBe(old);
		expect(refused.error?.code).toBe('CONFLICT');
		expect(handler.state.value).toBe('typed by the person');
	});

	it('is new, with nothing remembered, for a control registered again', async () => {
		const registry = new ControlRegistry();
		const handler = textHandler();
		registry.register('name', handler);
		const commands = commandsOf(registry);
		const read = await commands.execute<ControlListResult>('control-list', {});
		const set = await commands.execute<ControlSetResult>(
			'control-set',
			{
				values: [{ id: 'name', value: 'Ada', rev: read.data?.controls[0]?.rev }],
			},
			AGENT
		);
		const setRev = set.data?.changed[0]?.rev as string;

		registry.unregister('name');
		registry.register('name', handler);
		const again = await commands.execute<ControlListResult>('control-list', {});
		const restore = await commands.execute('control-restore', {
			controls: [{ id: 'name', rev: setRev }],
		});

		expect(again.data?.controls[0]?.rev).not.toBe(setRev);
		expect(restore.data).toMatchObject({
			restored: [],
			skipped: [{ id: 'name', reason: 'changed' }],
		});
		expect(handler.state.value).toBe('Ada');
	});
});

describe('controlStore', () => {
	it('refuses what is not a registry', () => {
		expect(() => controlStore({} as ControlRegistry)).toThrow(TypeError);
	});
});

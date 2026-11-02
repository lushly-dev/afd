import { describe, expect, it } from 'vitest';
import {
	type ConsoleCommand,
	filterCommands,
	filterStatus,
	readCommands,
	rowFlag,
	rowTitle,
} from './commands.js';

const command = (over: Partial<ConsoleCommand>): ConsoleCommand => ({
	name: 'demo-ping',
	mutation: false,
	destructive: false,
	approval: false,
	inputSchema: {},
	...over,
});

describe('readCommands: a row may be a mounted server', () => {
	it('keeps what it needs from a good row', () => {
		expect(
			readCommands([
				{
					name: 'a-b',
					title: 'T',
					description: 'D',
					mutation: true,
					destructive: true,
					inputSchema: { type: 'object' },
					extra: 'dropped',
				},
			])
		).toEqual([
			{
				name: 'a-b',
				title: 'T',
				description: 'D',
				mutation: true,
				destructive: true,
				approval: false,
				inputSchema: { type: 'object' },
			},
		]);
	});

	it('drops what is not a command, and text that is not text', () => {
		expect(readCommands('hostile')).toEqual([]);
		expect(readCommands([null, 1, {}, { name: 3 }, { name: '' }])).toEqual([]);
		const [row] = readCommands([
			{ name: 'a-b', title: { create: 1 }, description: ['x'], mutation: 'yes', destructive: 1 },
		]);
		expect(row).toEqual({
			name: 'a-b',
			mutation: false,
			destructive: false,
			approval: false,
			inputSchema: undefined,
		});
	});
});

describe('a row', () => {
	it("shows the command's title or name", () => {
		expect(rowTitle(command({ title: 'Ping' }))).toBe('Ping');
		expect(rowTitle(command({ title: '' }))).toBe('demo-ping');
		expect(rowTitle(command({}))).toBe('demo-ping');
	});

	it('says "Changes data" or "Destructive", and destructive wins', () => {
		expect(rowFlag(command({}))).toBe('');
		expect(rowFlag(command({ mutation: true }))).toBe('Changes data');
		expect(rowFlag(command({ mutation: true, destructive: true }))).toBe('Destructive');
		expect(rowFlag(command({ destructive: true }))).toBe('Destructive');
	});
});

describe('the filter', () => {
	const all = [command({ name: 'a-one', title: 'First' }), command({ name: 'b-two' })];

	it('matches a name or a title, whatever the case', () => {
		expect(filterCommands(all, '  ')).toBe(all);
		expect(filterCommands(all, 'FIRST').map(({ name }) => name)).toEqual(['a-one']);
		expect(filterCommands(all, 'b-t').map(({ name }) => name)).toEqual(['b-two']);
		expect(filterCommands(all, 'nothing')).toEqual([]);
	});

	it('says what it found', () => {
		expect(filterStatus(0, 0, '')).toBe('This app has no commands to run here.');
		expect(filterStatus(2, 2, '')).toBe('');
		expect(filterStatus(2, 1, ' a ')).toBe('1 of 2 commands');
		expect(filterStatus(2, 0, ' a ')).toBe('No command matches "a".');
	});
});

describe('a reported approval', () => {
	it('is read only as the word the protocol uses', () => {
		const [named, other] = readCommands([
			{ name: 'a-b', approval: 'required' },
			{ name: 'c-d', approval: { create: 1 } },
		]);
		expect(named?.approval).toBe(true);
		expect(other?.approval).toBe(false);
	});

	it('is said in words, beside what else a row says', () => {
		expect(rowFlag(command({ approval: true }))).toBe('Needs approval');
		expect(rowFlag(command({ mutation: true, approval: true }))).toBe(
			'Changes data, Needs approval'
		);
		expect(rowFlag(command({ destructive: true, approval: true }))).toBe(
			'Destructive, Needs approval'
		);
	});
});

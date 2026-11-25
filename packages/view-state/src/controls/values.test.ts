/**
 * @fileoverview Which values a control takes, and the words of each refusal (the
 * specification's section 5.2). `commands.test.ts` shows the same words in `control-set`'s error.
 */

import { evaluateResult } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import type { ControlChoice, ControlState, ControlValue } from './types.js';
import { checkValue, inFormat, type ValueCheck } from './values.js';

function text(extra: Partial<ControlState> = {}): ControlState {
	return { kind: 'text', label: 'Text', value: '', ...extra };
}

function refusal(check: ValueCheck): { reason: string; suggestion: string } {
	if (check.ok) throw new Error(`expected a refusal, got ${JSON.stringify(check.value)}`);
	// afd-testing reads a recovery only when it passes isCommandRecovery (spec/recovery.md, rule 7).
	const read = evaluateResult(
		{ success: false, error: { code: 'VALIDATION_ERROR', message: '', recovery: check.recovery } },
		{ success: false, error: { recovery: { kind: check.recovery.kind } } }
	);
	expect(read.passed).toBe(true);
	return { reason: check.reason, suggestion: check.suggestion };
}

function taken(check: ValueCheck): ControlValue {
	if (!check.ok) throw new Error(`expected the value to be taken, got "${check.reason}"`);
	return check.value;
}

const SESSIONS: ControlChoice[] = [
	{ value: 'morning', label: 'Morning' },
	{ value: 'afternoon', label: 'Afternoon' },
	{ value: 'evening', label: 'Evening' },
];

const COUNTRIES: ControlChoice[] = Array.from({ length: 14 }, (_, index) => ({
	value: `c${index}`,
	label: `Country ${index}`,
}));

describe('text', () => {
	it('takes a string and refuses anything else', () => {
		expect(taken(checkValue('t', text(), 'Ada'))).toBe('Ada');
		expect(refusal(checkValue('t', text(), 4))).toEqual({
			reason: 'takes text',
			suggestion: 'Send text',
		});
	});

	it('takes no more than maxLength characters, counted as String.length does', () => {
		const control = text({ maxLength: 3 });
		expect(taken(checkValue('t', control, 'abc'))).toBe('abc');
		expect(taken(checkValue('t', control, '😀a'))).toBe('😀a');
		expect(refusal(checkValue('t', control, 'abcd'))).toEqual({
			reason: 'is longer than 3 characters',
			suggestion: 'Send at most 3 characters',
		});
	});

	it('checks maxLength before the format', () => {
		const control = text({ maxLength: 2, format: 'email' });
		expect(refusal(checkValue('t', control, 'abc')).reason).toBe('is longer than 2 characters');
	});

	it.each([
		[
			'email',
			['ada@example.org', 'a.b@c.d.e'],
			[
				'ada',
				'ada@',
				'@example.org',
				'ada@example',
				'a da@x.org',
				'a@b@c.org',
				'ada@.org',
				'ada@example.',
			],
		],
		[
			'date',
			['2026-11-24', '2024-02-29', '2000-02-29'],
			[
				'2026-02-29',
				'1900-02-29',
				'2026-13-01',
				'2026-04-31',
				'2026-00-10',
				'2026-01-00',
				'26-11-24',
				'2026-1-24',
				'2026-11-24T10:00',
			],
		],
		[
			'time',
			['09:30', '23:59:59', '00:00'],
			['24:00', '9:30', '12:60', '12:30:60', '12', '12:30 pm'],
		],
		['color', ['#a1B2c3', '#000000'], ['a1b2c3', '#abc', '#a1b2c3d', '#ggg000']],
	] as const)('takes %s text in the format and refuses text that is not', (format, good, bad) => {
		for (const value of good) expect(inFormat(format, value), value).toBe(true);
		for (const value of bad) expect(inFormat(format, value), value).toBe(false);
	});

	it.each([
		['email', 'is not an email address', 'Send an email address'],
		['date', 'is not a date', 'Send a date as YYYY-MM-DD'],
		['time', 'is not a time', 'Send a time as HH:MM'],
		['color', 'is not a colour', 'Send a colour as #rrggbb'],
	] as const)('refuses text that is not %s in its words', (format, reason, suggestion) => {
		expect(refusal(checkValue('t', text({ format }), 'nope'))).toEqual({ reason, suggestion });
	});

	it('takes an empty string whatever its format', () => {
		for (const format of ['email', 'date', 'time', 'color'] as const) {
			expect(taken(checkValue('t', text({ format, required: true }), ''))).toBe('');
		}
	});
});

describe('number', () => {
	it('takes a finite number and refuses text that reads as one', () => {
		const control: ControlState = { kind: 'number', label: 'Seats', value: 1 };
		expect(taken(checkValue('n', control, 3))).toBe(3);
		for (const value of ['3', Number.NaN, Number.POSITIVE_INFINITY, true]) {
			expect(refusal(checkValue('n', control, value as ControlValue))).toEqual({
				reason: 'takes a number',
				suggestion: 'Send a number',
			});
		}
	});

	it('with min and max, refuses a number outside both', () => {
		const control: ControlState = { kind: 'number', label: 'Seats', value: 1, min: 1, max: 4 };
		expect(taken(checkValue('n', control, 1))).toBe(1);
		expect(taken(checkValue('n', control, 4))).toBe(4);
		for (const value of [0, 5]) {
			expect(refusal(checkValue('n', control, value))).toEqual({
				reason: 'is not between 1 and 4',
				suggestion: 'Send a number between 1 and 4',
			});
		}
	});

	it('with only min, refuses a number below it', () => {
		const control: ControlState = { kind: 'number', label: 'Age', value: 18, min: 18 };
		expect(taken(checkValue('n', control, 1000))).toBe(1000);
		expect(refusal(checkValue('n', control, 17))).toEqual({
			reason: 'is less than 18',
			suggestion: 'Send a number of at least 18',
		});
	});

	it('with only max, refuses a number above it', () => {
		const control: ControlState = { kind: 'number', label: 'Nights', value: 1, max: 7 };
		expect(taken(checkValue('n', control, -3))).toBe(-3);
		expect(refusal(checkValue('n', control, 8))).toEqual({
			reason: 'is more than 7',
			suggestion: 'Send a number of at most 7',
		});
	});

	it('cannot be emptied', () => {
		const control: ControlState = { kind: 'number', label: 'Seats', value: 1 };
		expect(refusal(checkValue('n', control, '')).reason).toBe('takes a number');
	});
});

describe('boolean', () => {
	it('takes true or false and nothing else, so it cannot be emptied', () => {
		const control: ControlState = { kind: 'boolean', label: 'News', value: false };
		expect(taken(checkValue('b', control, true))).toBe(true);
		for (const value of ['yes', '', 1, ['true']]) {
			expect(refusal(checkValue('b', control, value as ControlValue))).toEqual({
				reason: 'takes true or false',
				suggestion: 'Send true or false',
			});
		}
	});
});

describe('choice', () => {
	const session: ControlState = {
		kind: 'choice',
		label: 'Session',
		value: 'morning',
		choices: SESSIONS,
	};
	const listed = 'Its choices: morning (Morning), afternoon (Afternoon), evening (Evening)';

	it('takes a choice by its value, or by its label without regard to case, and gives the value', () => {
		expect(taken(checkValue('s', session, 'evening'))).toBe('evening');
		expect(taken(checkValue('s', session, 'Evening'))).toBe('evening');
		expect(taken(checkValue('s', session, 'aFTERNOON'))).toBe('afternoon');
	});

	it('takes a value before a label that is the same text', () => {
		const control: ControlState = {
			...session,
			choices: [
				{ value: 'a', label: 'b' },
				{ value: 'b', label: 'B choice' },
			],
		};
		expect(taken(checkValue('s', control, 'b'))).toBe('b');
	});

	it('refuses what is not a string, and what names no choice, listing ten or fewer', () => {
		expect(refusal(checkValue('s', session, 3))).toEqual({
			reason: 'takes one of its choices',
			suggestion: listed,
		});
		expect(refusal(checkValue('s', session, 'weekend'))).toEqual({
			reason: 'is not one of its choices',
			suggestion: listed,
		});
	});

	it('says a control with no choices has none to take', () => {
		const none = 'It has no choices to take';
		const empty: ControlState = { ...session, value: '', choices: [] };
		const { choices: _, ...unset } = empty;

		expect(refusal(checkValue('s', empty, 'morning'))).toEqual({
			reason: 'is not one of its choices',
			suggestion: none,
		});
		expect(refusal(checkValue('s', unset, 3))).toEqual({
			reason: 'takes one of its choices',
			suggestion: none,
		});
		expect(refusal(checkValue('s', { ...empty, kind: 'choices', value: [] }, ['morning']))).toEqual(
			{ reason: 'is not one of its choices', suggestion: none }
		);
	});

	it('refuses a label two choices share', () => {
		const control: ControlState = {
			...session,
			choices: [
				{ value: 'am', label: 'Early' },
				{ value: 'dawn', label: 'early' },
			],
		};
		expect(refusal(checkValue('s', control, 'EARLY'))).toEqual({
			reason: 'matches more than one choice',
			suggestion: 'Its choices: am (Early), dawn (early)',
		});
	});

	it('takes an empty string only when one of its choices has that value', () => {
		expect(refusal(checkValue('s', session, '')).reason).toBe('is not one of its choices');
		const control: ControlState = {
			...session,
			choices: [{ value: '', label: 'None' }, ...SESSIONS],
		};
		expect(taken(checkValue('s', control, ''))).toBe('');
	});

	it('names control-choices for more than ten choices, with the call that searches them', () => {
		const control: ControlState = {
			kind: 'choice',
			label: 'Country',
			value: '',
			choices: COUNTRIES,
		};
		const check = checkValue('country', control, 'Atlantis');
		expect(check).toEqual({
			ok: false,
			reason: 'is not one of its choices',
			suggestion: 'Use control-choices to search its 14 choices',
			recovery: { kind: 'call', command: 'control-choices', input: { id: 'country' } },
		});
	});

	it('takes a choice among more than ten', () => {
		const control: ControlState = {
			kind: 'choice',
			label: 'Country',
			value: '',
			choices: COUNTRIES,
		};
		expect(taken(checkValue('country', control, 'Country 12'))).toBe('c12');
	});
});

describe('choices', () => {
	const diet: ControlState = {
		kind: 'choices',
		label: 'Diet',
		value: [],
		choices: [
			{ value: 'vegan', label: 'Vegan' },
			{ value: 'gluten-free', label: 'Gluten-free' },
		],
	};
	const listed = 'Its choices: vegan (Vegan), gluten-free (Gluten-free)';

	it('takes a list of choices, each by its value or label, and gives the values', () => {
		expect(taken(checkValue('d', diet, ['Gluten-free', 'vegan']))).toEqual([
			'gluten-free',
			'vegan',
		]);
	});

	it('takes an empty list', () => {
		expect(taken(checkValue('d', diet, []))).toEqual([]);
	});

	it('refuses what is not a list of strings', () => {
		for (const value of ['vegan', [1], true]) {
			expect(refusal(checkValue('d', diet, value as ControlValue))).toEqual({
				reason: 'takes a list of its choices',
				suggestion: listed,
			});
		}
	});

	it('refuses a list with an unknown entry', () => {
		expect(refusal(checkValue('d', diet, ['vegan', 'paleo']))).toEqual({
			reason: 'is not one of its choices',
			suggestion: listed,
		});
	});

	it('refuses a list that names one choice twice, by value or by label', () => {
		expect(refusal(checkValue('d', diet, ['vegan', 'Vegan']))).toEqual({
			reason: 'names vegan more than once',
			suggestion: listed,
		});
	});

	it('checks every entry names a choice before it checks for one named twice', () => {
		expect(refusal(checkValue('d', diet, ['vegan', 'vegan', 'paleo'])).reason).toBe(
			'is not one of its choices'
		);
	});
});

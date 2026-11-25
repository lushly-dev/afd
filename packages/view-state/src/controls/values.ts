/**
 * @fileoverview What a control's state comes to, how two states compare, and which values a
 * control takes (the specification's sections 2 and 5.2).
 */

import type { CommandError } from '@lushly-dev/afd-server/define';
import type {
	Control,
	ControlChoice,
	ControlFormat,
	ControlKind,
	ControlState,
	ControlValue,
} from './types.js';

/** What a refusal tells the caller to do next (`spec/recovery.md`). */
export type ControlRecovery = NonNullable<CommandError['recovery']>;

/** The most choices a listing or a refusal carries; a control with more is searched. */
export const LISTED_CHOICES = 10;

const FLAGS = ['required', 'disabled', 'readOnly', 'hidden', 'secret'] as const;

/** Whether a control of this kind offers choices. */
export function hasChoices(kind: ControlKind): boolean {
	return kind === 'choice' || kind === 'choices';
}

/** A value that shares nothing with the one given: a list is copied. */
export function copyValue(value: ControlValue): ControlValue {
	return Array.isArray(value) ? [...value] : value;
}

const KINDS: readonly unknown[] = ['text', 'number', 'boolean', 'choice', 'choices'];
const FORMATS: readonly unknown[] = ['email', 'date', 'time', 'color'];
const TEXTS = ['group', 'description', 'error'] as const;
const NUMBERS = ['min', 'max', 'maxLength'] as const;

function isText(value: unknown): value is string {
	return typeof value === 'string';
}

/** Whether every item of a list passes, a gap in it among them: `every` alone skips gaps. */
function everyItem(list: unknown[], test: (item: unknown) => boolean): boolean {
	return Array.from(list).every(test);
}

function isChoice(choice: unknown): boolean {
	if (typeof choice !== 'object' || choice === null) return false;
	const { value, label } = choice as Record<string, unknown>;
	return isText(value) && isText(label);
}

/**
 * What stops a handler's reading from being a state, or `undefined` when it is one. It names
 * the field and never what the field holds, which may be a secret's value.
 */
function stateFault(read: unknown): string | undefined {
	if (typeof read !== 'object' || read === null) return 'its handler read no state';
	const state = read as Record<string, unknown>;
	if (!KINDS.includes(state.kind)) return 'its kind is not one a control has';
	if (!isText(state.label)) return 'its label is not text';
	const { value } = state;
	const scalar = isText(value) || typeof value === 'number' || typeof value === 'boolean';
	if (!scalar && !(Array.isArray(value) && everyItem(value, isText))) {
		return 'its value is not text, a number, true or false, or a list of text';
	}
	for (const field of TEXTS) {
		if (state[field] !== undefined && !isText(state[field])) return `its ${field} is not text`;
	}
	for (const field of NUMBERS) {
		if (state[field] !== undefined && typeof state[field] !== 'number') {
			return `its ${field} is not a number`;
		}
	}
	// A flag it has that is not true or false is not read as false: that would show a secret.
	for (const flag of FLAGS) {
		if (state[flag] !== undefined && typeof state[flag] !== 'boolean') {
			return `its ${flag} is not true or false`;
		}
	}
	if (state.format !== undefined && !FORMATS.includes(state.format)) {
		return 'its format is not one a control has';
	}
	const { choices } = state;
	if (choices !== undefined && !(Array.isArray(choices) && everyItem(choices, isChoice))) {
		return 'its choices are not a list of values with labels';
	}
	return undefined;
}

/**
 * A copy of what a handler read, with nothing that compares as absent: a false flag, an
 * `undefined` field and an empty error are left out.
 *
 * @throws Error when what was read is not a state, saying which field is not
 */
export function normalizeState(state: ControlState): ControlState {
	const fault = stateFault(state);
	if (fault !== undefined) throw new Error(fault);
	const normal: ControlState = {
		kind: state.kind,
		label: state.label,
		value: copyValue(state.value),
	};
	if (state.group !== undefined) normal.group = state.group;
	if (state.description !== undefined) normal.description = state.description;
	if (state.format !== undefined) normal.format = state.format;
	for (const flag of FLAGS) {
		if (state[flag] === true) normal[flag] = true;
	}
	if (state.min !== undefined) normal.min = state.min;
	if (state.max !== undefined) normal.max = state.max;
	if (state.maxLength !== undefined) normal.maxLength = state.maxLength;
	if (state.choices !== undefined) {
		normal.choices = state.choices.map((choice) => ({ value: choice.value, label: choice.label }));
	}
	if (state.error !== undefined && state.error !== '') normal.error = state.error;
	return normal;
}

function sameScalar(a: unknown, b: unknown): boolean {
	return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/** Whether two values are the same, a list item by item. */
export function sameValue(a: ControlValue | undefined, b: ControlValue | undefined): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => item === b[index])
		);
	}
	return sameScalar(a, b);
}

function sameChoices(a: ControlChoice[] | undefined, b: ControlChoice[] | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.length === b.length &&
		a.every((choice, index) => choice.value === b[index]?.value && choice.label === b[index]?.label)
	);
}

/** Whether two normalized states are the same, field by field. */
export function sameState(a: ControlState, b: ControlState): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ControlState>;
	for (const key of keys) {
		if (key === 'value') {
			if (!sameValue(a.value, b.value)) return false;
		} else if (key === 'choices') {
			if (!sameChoices(a.choices, b.choices)) return false;
		} else if (!sameScalar(a[key], b[key])) {
			return false;
		}
	}
	return true;
}

/** Whether a resolved value is what the control holds; a list of choices without regard to order. */
export function holdsValue(state: ControlState, value: ControlValue): boolean {
	if (state.kind === 'choices' && Array.isArray(value) && Array.isArray(state.value)) {
		const held = [...state.value].sort();
		const sent = [...value].sort();
		return held.length === sent.length && held.every((item, index) => item === sent[index]);
	}
	return sameValue(state.value, value);
}

/** Whether a control holds an empty string or an empty list. */
export function isEmpty(state: ControlState): boolean {
	return state.value === '' || (Array.isArray(state.value) && state.value.length === 0);
}

/** A control as `control-list` gives it. */
export function toControl(id: string, rev: string, state: ControlState): Control {
	const { secret } = state;
	const control: Control = {
		id,
		...(secret ? {} : { rev }),
		...(state.group !== undefined ? { group: state.group } : {}),
		kind: state.kind,
		label: state.label,
		...(state.description !== undefined ? { description: state.description } : {}),
		...(secret ? {} : { value: copyValue(state.value) }),
		...(state.format !== undefined ? { format: state.format } : {}),
	};
	for (const flag of FLAGS) {
		if (state[flag]) control[flag] = true;
	}
	if (state.min !== undefined) control.min = state.min;
	if (state.max !== undefined) control.max = state.max;
	if (state.maxLength !== undefined) control.maxLength = state.maxLength;
	if (hasChoices(state.kind)) {
		const choices = state.choices ?? [];
		if (choices.length <= LISTED_CHOICES) {
			control.choices = choices.map((choice) => ({ ...choice }));
		} else {
			control.choiceCount = choices.length;
		}
	}
	if (!secret && state.error !== undefined) control.error = state.error;
	return control;
}

// ─── Values (section 5.2) ────────────────────────────────────────────────────

/** A value a control takes, resolved to what is written; or why it is refused. */
export type ValueCheck =
	| { ok: true; value: ControlValue }
	| { ok: false; reason: string; suggestion: string; recovery: ControlRecovery };

const FIX_VALUES: ControlRecovery = { kind: 'fix-input', needs: ['values'] };

function refuse(reason: string, suggestion: string): ValueCheck {
	return { ok: false, reason, suggestion, recovery: FIX_VALUES };
}

const FORMAT_WORDS: Record<ControlFormat, { reason: string; suggestion: string }> = {
	email: { reason: 'is not an email address', suggestion: 'Send an email address' },
	date: { reason: 'is not a date', suggestion: 'Send a date as YYYY-MM-DD' },
	time: { reason: 'is not a time', suggestion: 'Send a time as HH:MM' },
	color: { reason: 'is not a colour', suggestion: 'Send a colour as #rrggbb' },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

function isDay(text: string): boolean {
	const match = DATE.exec(text);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
	return day <= days;
}

/** Whether text is in a format, as section 5.2 defines the four. */
export function inFormat(format: ControlFormat, text: string): boolean {
	switch (format) {
		case 'email':
			return EMAIL.test(text);
		case 'date':
			return isDay(text);
		case 'time':
			return TIME.test(text);
		case 'color':
			return COLOUR.test(text);
		default:
			return true;
	}
}

function checkText(state: ControlState, value: ControlValue): ValueCheck {
	if (typeof value !== 'string') return refuse('takes text', 'Send text');
	if (state.maxLength !== undefined && value.length > state.maxLength) {
		return refuse(
			`is longer than ${state.maxLength} characters`,
			`Send at most ${state.maxLength} characters`
		);
	}
	if (value !== '' && state.format !== undefined && !inFormat(state.format, value)) {
		const words = FORMAT_WORDS[state.format];
		return refuse(words.reason, words.suggestion);
	}
	return { ok: true, value };
}

function checkNumber(state: ControlState, value: ControlValue): ValueCheck {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return refuse('takes a number', 'Send a number');
	}
	const { min, max } = state;
	if (min !== undefined && max !== undefined) {
		if (value < min || value > max) {
			return refuse(`is not between ${min} and ${max}`, `Send a number between ${min} and ${max}`);
		}
	} else if (min !== undefined && value < min) {
		return refuse(`is less than ${min}`, `Send a number of at least ${min}`);
	} else if (max !== undefined && value > max) {
		return refuse(`is more than ${max}`, `Send a number of at most ${max}`);
	}
	return { ok: true, value };
}

/** The suggestion and recovery of every refusal of a value for a choice control. */
function choiceRefusal(id: string, choices: ControlChoice[], reason: string): ValueCheck {
	if (choices.length === 0) return refuse(reason, 'It has no choices to take');
	if (choices.length <= LISTED_CHOICES) {
		const listed = choices.map((choice) => `${choice.value} (${choice.label})`).join(', ');
		return refuse(reason, `Its choices: ${listed}`);
	}
	return {
		ok: false,
		reason,
		suggestion: `Use control-choices to search its ${choices.length} choices`,
		recovery: { kind: 'call', command: 'control-choices', input: { id } },
	};
}

/** The choice a string names: its value, or else the one label equal to it without regard to case. */
function nameChoice(choices: ControlChoice[], text: string): ControlChoice | 'none' | 'several' {
	const byValue = choices.find((choice) => choice.value === text);
	if (byValue) return byValue;
	if (text === '') return 'none';
	const folded = text.toLowerCase();
	const byLabel = choices.filter((choice) => choice.label.toLowerCase() === folded);
	if (byLabel.length === 1) return byLabel[0] as ControlChoice;
	return byLabel.length === 0 ? 'none' : 'several';
}

function resolveChoice(
	id: string,
	choices: ControlChoice[],
	text: string
): { ok: true; value: string } | ValueCheck {
	const named = nameChoice(choices, text);
	if (named === 'none') return choiceRefusal(id, choices, 'is not one of its choices');
	if (named === 'several') return choiceRefusal(id, choices, 'matches more than one choice');
	return { ok: true, value: named.value };
}

function checkChoice(id: string, state: ControlState, value: ControlValue): ValueCheck {
	const choices = state.choices ?? [];
	if (typeof value !== 'string') return choiceRefusal(id, choices, 'takes one of its choices');
	return resolveChoice(id, choices, value);
}

function checkChoices(id: string, state: ControlState, value: ControlValue): ValueCheck {
	const choices = state.choices ?? [];
	if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
		return choiceRefusal(id, choices, 'takes a list of its choices');
	}
	const resolved: string[] = [];
	for (const item of value) {
		const named = resolveChoice(id, choices, item);
		if (!named.ok) return named;
		resolved.push(named.value as string);
	}
	const seen = new Set<string>();
	for (const item of resolved) {
		if (seen.has(item)) return choiceRefusal(id, choices, `names ${item} more than once`);
		seen.add(item);
	}
	return { ok: true, value: resolved };
}

/** Whether the control takes the value (section 5.2), and the value it resolves to. */
export function checkValue(id: string, state: ControlState, value: ControlValue): ValueCheck {
	switch (state.kind) {
		case 'number':
			return checkNumber(state, value);
		case 'boolean':
			return typeof value === 'boolean'
				? { ok: true, value }
				: refuse('takes true or false', 'Send true or false');
		case 'choice':
			return checkChoice(id, state, value);
		case 'choices':
			return checkChoices(id, state, value);
		default:
			return checkText(state, value);
	}
}

/** What a control that has no choices takes, in the words of `control-choices`. */
export function whatItTakes(kind: ControlKind): string {
	switch (kind) {
		case 'number':
			return 'a number';
		case 'boolean':
			return 'true or false';
		default:
			return 'text';
	}
}

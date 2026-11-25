/**
 * @fileoverview The types of Controls: what a handler says its control is, and what
 * `control-list` gives an agent for it.
 */

/** What a control takes: text, a number, true or false, one choice, or several. */
export type ControlKind = 'text' | 'number' | 'boolean' | 'choice' | 'choices';

/** A control's value, by kind: a string, a number, a boolean, or a list of choice values. */
export type ControlValue = string | number | boolean | string[];

/** The form a `text` control's value must have. */
export type ControlFormat = 'email' | 'date' | 'time' | 'color';

/** One of the choices a `choice` or `choices` control offers. */
export interface ControlChoice {
	value: string;
	label: string;
}

/** What a handler says its control is, each time it is asked. */
export interface ControlState {
	kind: ControlKind;
	label: string;
	value: ControlValue;
	group?: string;
	description?: string;
	format?: ControlFormat;
	required?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	hidden?: boolean;
	secret?: boolean;
	min?: number;
	max?: number;
	maxLength?: number;
	/** Every choice; the registry decides what a listing carries. */
	choices?: ControlChoice[];
	error?: string;
}

/**
 * Reads and writes one control. Both are synchronous: each returns when it is done.
 *
 * @example
 * ```ts
 * let name = '';
 * registry.register('attendee-name', {
 *   read: () => ({ kind: 'text', label: 'Full name', value: name, required: true }),
 *   write: (value) => {
 *     name = String(value);
 *   },
 * });
 * ```
 */
export interface ControlHandler {
	/** What the control is now. An error it throws is shown to the caller: put no value in its message. */
	read(): ControlState;
	/** Set the control's value. An error it throws is shown to the caller: put no value in its message. */
	write(value: ControlValue): void;
}

/**
 * A control as `control-list` gives it. A flag that is false is left out. A secret has no
 * `value`, `error` or `rev`. A choice control carries `choices` when it has ten or fewer, and
 * `choiceCount` otherwise.
 */
export interface Control extends Omit<ControlState, 'value' | 'choices' | 'error'> {
	id: string;
	rev?: string;
	value?: ControlValue;
	choices?: ControlChoice[];
	choiceCount?: number;
	error?: string;
}

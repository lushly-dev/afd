import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInProcessBench as createSpecimenBench } from './bench-runtime.js';
import type { SpecimenHostError } from './host.js';
import { observationSchema } from './schema.js';
import { CAPTURE_VERSION, type Observation } from './types.js';

const packLibrary = resolve(import.meta.dirname, '../fixtures/pack-library');

describe('Patterns B2: press, capture 0.10 ARIA states, role sets, and portable expectations', () => {
	let root: string;
	let bench: Awaited<ReturnType<typeof createSpecimenBench>>;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-portable-gates-')));
		const selectModule = JSON.stringify(join(packLibrary, 'select.js'));
		const fieldModule = JSON.stringify(join(packLibrary, 'field.js'));
		await writeFile(
			join(root, 'elements.js'),
			`import ${selectModule};
import ${fieldModule};

/** Shadow-DOM form-associated select whose trigger is an inner <button>. */
class ShadowSelect extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'name', 'value', 'required', 'disabled'];
	#internals = this.attachInternals();
	#open = false;
	#value = '';
	constructor() {
		super();
		const shadow = this.attachShadow({ mode: 'open' });
		shadow.innerHTML = \`
			<style>
				:host { display: block; width: 100%; box-sizing: border-box; margin: 0; }
				button { display: block; width: 100%; min-height: 36px; box-sizing: border-box; }
				[role="listbox"][hidden] { display: none; }
			</style>
			<button type="button" aria-haspopup="listbox" aria-expanded="false"></button>
			<div role="listbox" hidden>
				<div role="option" data-value="apple" aria-selected="false">Apple</div>
				<div role="option" data-value="pear" aria-selected="false">Pear</div>
			</div>
		\`;
		this.#trigger = shadow.querySelector('button');
		this.#listbox = shadow.querySelector('[role="listbox"]');
		this.#options = [...shadow.querySelectorAll('[role="option"]')];
		this.#trigger.addEventListener('click', () => {
			if (this.hasAttribute('disabled')) return;
			this.#setOpen(!this.#open);
		});
		this.#trigger.addEventListener('keydown', (event) => {
			if (this.hasAttribute('disabled')) return;
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				if (!this.#open) this.#setOpen(true);
				this.#selectIndex(0);
			} else if (event.key === 'End') {
				event.preventDefault();
				this.#selectIndex(this.#options.length - 1);
			} else if (event.key === 'Escape' && this.#open) {
				event.preventDefault();
				this.#setOpen(false);
				this.#trigger.focus();
			} else if (event.key === 'Enter' && this.#open) {
				event.preventDefault();
				this.#commit();
			}
		});
	}
	#trigger;
	#listbox;
	#options;
	#activeIndex = -1;
	connectedCallback() {
		this.#sync();
	}
	attributeChangedCallback() {
		this.#sync();
	}
	get form() {
		return this.#internals.form;
	}
	checkValidity() {
		return this.#internals.checkValidity();
	}
	#setOpen(next) {
		this.#open = next;
		this.#trigger.setAttribute('aria-expanded', String(next));
		this.#listbox.hidden = !next;
	}
	#selectIndex(index) {
		this.#activeIndex = index;
		this.#options.forEach((opt, i) => opt.setAttribute('aria-selected', String(i === index)));
	}
	#commit() {
		const chosen = this.#options[this.#activeIndex];
		if (!chosen) return;
		this.#value = chosen.dataset.value ?? '';
		this.#setOpen(false);
		this.#sync();
		this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
	}
	#sync() {
		if (!this.#trigger) return;
		const label = this.getAttribute('label') ?? '';
		const current = this.#value || this.getAttribute('value') || '';
		const chosen = this.#options.find((opt) => opt.dataset.value === current);
		this.#trigger.textContent = label + ' ' + (chosen ? chosen.textContent : 'Select an option');
		const disabled = this.hasAttribute('disabled');
		this.#trigger.disabled = disabled;
		const required = this.hasAttribute('required');
		this.#internals.setFormValue(current);
		if (required && !current) {
			this.#internals.setValidity({ valueMissing: true }, 'Please choose an option', this.#trigger);
			this.#trigger.setAttribute('aria-invalid', 'true');
		} else {
			this.#internals.setValidity({});
			this.#trigger.setAttribute('aria-invalid', 'false');
		}
	}
}
if (!customElements.get('shadow-select')) customElements.define('shadow-select', ShadowSelect);

/** Shadow-DOM form-associated field with a short inner <input> (18px) inside a 36px host box. */
class ShadowField extends HTMLElement {
	static formAssociated = true;
	static observedAttributes = ['label', 'name', 'value', 'invalid', 'readonly', 'required', 'disabled'];
	#internals = this.attachInternals();
	#input;
	constructor() {
		super();
		const shadow = this.attachShadow({ mode: 'open' });
		shadow.innerHTML = \`
			<style>
				:host { display: block; width: 100%; height: 36px; padding: 8px; box-sizing: border-box; margin: 0; }
				:host([outer-margin]) { margin-top: 12px; }
				:host([overflow-wide]) { width: 500px; }
				input { display: block; width: 100%; height: 18px; border: 0; padding: 0; margin: 0; box-sizing: border-box; }
			</style>
			<input type="text" />
		\`;
		this.#input = shadow.querySelector('input');
		this.#input.addEventListener('input', () => {
			this.#internals.setFormValue(this.#input.value);
		});
		this.#input.addEventListener('change', () => {
			this.#internals.setFormValue(this.#input.value);
			this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
		});
	}
	connectedCallback() {
		this.#sync();
	}
	attributeChangedCallback() {
		this.#sync();
	}
	get form() {
		return this.#internals.form;
	}
	checkValidity() {
		return this.#internals.checkValidity();
	}
	#sync() {
		if (!this.#input) return;
		this.#input.setAttribute('aria-label', this.getAttribute('label') ?? '');
		const val = this.getAttribute('value') ?? '';
		if (this.#input.value !== val) this.#input.value = val;
		this.#internals.setFormValue(val);
		const inv = this.getAttribute('invalid');
		if (inv !== null && inv !== 'false') {
			this.#input.setAttribute('aria-invalid', inv === '' ? 'true' : inv);
			if (inv === '' || inv === 'true') {
				this.#internals.setValidity({ customError: true }, 'Invalid value', this.#input);
			} else {
				this.#internals.setValidity({});
			}
		} else {
			this.#input.removeAttribute('aria-invalid');
			this.#internals.setValidity({});
		}
		this.#input.readOnly = this.hasAttribute('readonly');
		this.#input.required = this.hasAttribute('required');
		this.#input.disabled = this.hasAttribute('disabled');
	}
}
if (!customElements.get('shadow-field')) customElements.define('shadow-field', ShadowField);

export const AriaStatesCapture = {
	render: () => {
		const box = document.createElement('div');
		box.innerHTML = \`
			<h2>Controls</h2>
			<example-field label="Email" invalid value="bad"></example-field>
			<example-select label="Size" value="m"><example-option value="m" selected>Medium</example-option></example-select>
			<shadow-field label="Grammar note" value="He go" invalid="grammar" readonly required></shadow-field>
			<shadow-field label="Spelling note" value="teh" invalid="spelling"></shadow-field>
			<shadow-field label="Valid note"></shadow-field>
			<button type="button" aria-pressed="mixed">Bold</button>
			<button type="button" disabled>Locked</button>
			<input type="checkbox" aria-label="All items" />
		\`;
		box.querySelector('input[type="checkbox"]').indeterminate = true;
		return box;
	},
	targets: {
		email: { role: ['textbox', 'searchbox'], name: 'Email' },
		select: { role: ['combobox', 'button'], nameStartsWith: 'Size' },
		grammar: { role: ['textbox', 'searchbox'], nameContains: 'Grammar' },
		spelling: { role: ['textbox', 'searchbox'], nameContains: 'Spelling' },
		valid: { role: ['textbox', 'searchbox'], nameContains: 'Valid' },
		bold: { role: 'button', name: 'Bold' },
		locked: { role: 'button', name: 'Locked' },
		heading: { role: 'heading', name: 'Controls' },
		all: { role: 'checkbox', name: 'All items' },
	},
	scenario: [
		{ id: 'email-a11y', expect: { target: 'email', a11y: { role: ['textbox', 'searchbox'], nameNonEmpty: true, invalid: true } } },
		{ id: 'select-a11y', expect: { target: 'select', a11y: { role: ['combobox', 'button'], expanded: false, invalid: false } } },
		{ id: 'grammar-a11y', expect: { target: 'grammar', a11y: { invalid: true, readonly: true, required: true, disabled: false } } },
		{ id: 'spelling-a11y', expect: { target: 'spelling', a11y: { invalid: true } } },
		{ id: 'valid-a11y', expect: { target: 'valid', a11y: { invalid: false, readonly: false, required: false } } },
		{ id: 'bold-a11y', expect: { target: 'bold', a11y: { pressed: 'mixed' } } },
		{ id: 'locked-a11y', expect: { target: 'locked', a11y: { disabled: true } } },
		{ id: 'heading-a11y', expect: { target: 'heading', a11y: { level: 2, nameContains: 'Cont' } } },
		{ id: 'all-a11y', expect: { target: 'all', a11y: { checked: 'mixed' } } },
	],
};

export const SelectKeyboardAndFormClimb = {
	render: () => {
		const form = document.createElement('form');
		form.innerHTML = \`
			<button type="button">Before</button>
			<shadow-select label="Fruit" name="fruit" required></shadow-select>
			<button type="button">After</button>
		\`;
		return form;
	},
	targets: {
		before: { role: 'button', name: 'Before' },
		trigger: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' },
		after: { role: 'button', name: 'After' },
	},
	events: [{ type: 'change', target: 'trigger' }],
	scenario: [
		// Invalid initially: validity climbs from inner shadow <button> to <shadow-select>.
		{ id: 'initial-invalid', expect: { target: 'trigger', validity: { valid: false } } },
		{ id: 'initial-aria-invalid', expect: { target: 'trigger', a11y: { invalid: true, expanded: false } } },
		// Tab from Before -> trigger; Shift+Tab back -> Before; Tab -> trigger.
		{ id: 'focus-before', action: { focus: 'before' } },
		{ id: 'tab-to-trigger', action: { press: 'Tab' } },
		{ id: 'trigger-focused', expect: { target: 'trigger', focus: true } },
		{ id: 'shift-tab-back', action: { press: 'Shift+Tab' } },
		{ id: 'trigger-unfocused', expect: { target: 'trigger', focus: false } },
		{ id: 'before-focused', expect: { target: 'before', focus: true } },
		// Open with ArrowDown targeting trigger directly, then Escape closes and keeps focus.
		{ id: 'open-arrow', action: { press: 'ArrowDown', target: 'trigger' } },
		{ id: 'is-open', expect: { target: 'trigger', a11y: { expanded: true } } },
		{ id: 'close-esc', action: { press: 'Escape' } },
		{ id: 'is-closed', expect: { target: 'trigger', a11y: { expanded: false } } },
		{ id: 'focus-kept', expect: { target: 'trigger', focus: true } },
		// Open, press End to pick Pear, press Enter to commit -> change event + FormData + valid!
		{ id: 'reopen', action: { press: 'ArrowDown' } },
		{ id: 'pick-last', action: { press: 'End' } },
		{ id: 'commit', action: { press: 'Enter' } },
		{ id: 'change-fired', expect: { event: 'change', target: 'trigger', since: 'commit' } },
		{ id: 'form-has-pear', expect: { target: 'trigger', form: { name: 'fruit', value: 'pear' } } },
		{ id: 'now-valid', expect: { target: 'trigger', validity: { valid: true } } },
		{ id: 'name-updated', expect: { target: 'trigger', a11y: { nameContains: 'Pear', invalid: false } } },
	],
};

export const FieldLayoutHostClimb = {
	render: () => {
		const form = document.createElement('form');
		form.innerHTML = '<shadow-field label="Plant name" name="plant" value="Basil"></shadow-field>';
		return form;
	},
	targets: {
		field: { role: ['textbox', 'searchbox'], nameContains: 'Plant' },
	},
	scenario: [
		// Inner <input> is 18px tall, host <shadow-field> is 36px tall: host-climb makes minHeight: 24 pass.
		{ id: 'fits', expect: { target: 'field', layout: { minHeight: 24, minWidth: 100, noOverflow: true, noOuterMargin: true } } },
		{ id: 'form-val', expect: { target: 'field', form: { name: 'plant', value: 'Basil' } } },
		{ id: 'focus-it', action: { focus: 'field' } },
		{ id: 'is-focused', expect: { target: 'field', focus: true } },
	],
};

export const LayoutOverflowFailure = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Wide field" overflow-wide></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Wide field' } },
	scenario: [
		{ id: 'no-overflow', expect: { target: 'field', layout: { noOverflow: true }, timeoutMs: 50 } },
	],
};

export const LayoutOuterMarginFailure = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Margin field" outer-margin></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Margin field' } },
	scenario: [
		{ id: 'no-margin', expect: { target: 'field', layout: { noOuterMargin: true }, timeoutMs: 50 } },
	],
};

export const TargetRoleSetAmbiguous = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-select label="Fruit"></shadow-select><example-select label="Fruit Basket"></example-select>';
		return div;
	},
	targets: {
		fruit: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' },
	},
	scenario: [{ id: 'click', action: { click: 'fruit' } }],
};

export const TargetNameContainsMissing = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Email"></shadow-field>';
		return div;
	},
	targets: {
		missing: { role: ['textbox', 'searchbox'], nameContains: 'Phone' },
	},
	scenario: [{ id: 'focus', action: { focus: 'missing' } }],
};

export const A11yMismatchFailure = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Email"></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Email' } },
	scenario: [{ id: 'expect-invalid', expect: { target: 'field', a11y: { invalid: true }, timeoutMs: 50 } }],
};

class DualShadowHost extends HTMLElement {
	static formAssociated = true;
	constructor() {
		super();
		this.attachInternals();
		const root = this.attachShadow({ mode: 'open' });
		root.innerHTML = '<input aria-label="First" /><input aria-label="Second" />';
	}
}
if (!customElements.get('dual-shadow-host')) customElements.define('dual-shadow-host', DualShadowHost);

export const SharedHostEventIsolation = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<dual-shadow-host></dual-shadow-host>';
		return div;
	},
	targets: {
		first: { role: 'textbox', name: 'First' },
		second: { role: 'textbox', name: 'Second' },
	},
	events: [
		{ type: 'input', target: 'first' },
		{ type: 'input', target: 'second' },
	],
	scenario: [
		{ id: 'focus-second', action: { focus: 'second' } },
		{ id: 'check-focus', expect: { target: 'second', focus: true } },
		{ id: 'fill-second', action: { fill: 'second', value: 'hello' } },
		{ id: 'second-input', expect: { event: 'input', target: 'second', since: 'check-focus' } },
		{ id: 'first-no-input', expect: { event: 'input', target: 'first', since: 'check-focus', absent: true, timeoutMs: 50 } },
	],
};

class ExternalFormControl extends HTMLElement {
	static formAssociated = true;
	constructor() {
		super();
		const internals = this.attachInternals();
		internals.setFormValue('lavender');
		const root = this.attachShadow({ mode: 'open' });
		// Intentionally exposes no public .form getter on the host element.
		root.innerHTML = '<input aria-label="External note" value="lavender" />';
	}
}
if (!customElements.get('external-form-control')) {
	customElements.define('external-form-control', ExternalFormControl);
}

export const ExternalFormOwner = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML =
			'<form id="order"></form><form id="wrong"><external-form-control name="scent" form="order"></external-form-control></form>';
		return div;
	},
	targets: {
		note: { role: 'textbox', name: 'External note' },
	},
	scenario: [
		{ id: 'order-value', expect: { target: 'note', form: { name: 'scent', value: 'lavender' } } },
	],
};

export const PressDisabledTargetFailure = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<input aria-label="Active input" /><button disabled>Locked action</button>';
		return div;
	},
	targets: {
		input: { role: 'textbox', name: 'Active input' },
		locked: { role: 'button', name: 'Locked action' },
	},
	scenario: [
		{ id: 'focus-input', action: { focus: 'input' } },
		{ id: 'press-locked', action: { press: 'Enter', target: 'locked' } },
	],
};

export const PressPrintableSpaceAndUnicode = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<input aria-label="Note" />';
		const input = div.querySelector('input');
		const keys = [];
		input.addEventListener('keydown', (event) => {
			keys.push(event.key);
			input.dataset.keys = keys.join('|');
		});
		return div;
	},
	targets: {
		note: { role: 'textbox', name: 'Note' },
	},
	scenario: [
		{ id: 'press-e', action: { press: 'é', target: 'note' } },
		{ id: 'press-space', action: { press: ' ' } },
		{ id: 'press-a', action: { press: 'a' } },
		{ id: 'check-keys', expect: { target: 'note', state: { attribute: 'data-keys', equals: 'é| |a' } } },
		{ id: 'check-value', expect: { target: 'note', state: { property: 'value', equals: 'é a' } } },
	],
};

export const LayoutMountContainerWidth = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Wide field" style="width: 500px; height: 40px;"></shadow-field>';
		return div;
	},
	targets: {
		field: { role: 'textbox', name: 'Wide field' },
	},
	scenario: [
		{ id: 'fits-mount', expect: { target: 'field', layout: { minWidth: 500, noOverflow: true } } },
	],
};

export const InvalidPortableTimeoutZero = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Email"></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Email' } },
	scenario: [{ id: 'bad', expect: { target: 'field', focus: false, timeoutMs: 0 } }],
};

export const InvalidPortableTimeoutFloat = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Email"></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Email' } },
	scenario: [{ id: 'bad', expect: { target: 'field', focus: false, timeoutMs: 1.5 } }],
};

export const InvalidPortableTimeoutMax = {
	render: () => {
		const div = document.createElement('div');
		div.innerHTML = '<shadow-field label="Email"></shadow-field>';
		return div;
	},
	targets: { field: { role: 'textbox', name: 'Email' } },
	scenario: [{ id: 'bad', expect: { target: 'field', focus: false, timeoutMs: 60001 } }],
};
`
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					'AriaStatesCapture',
					'SelectKeyboardAndFormClimb',
					'FieldLayoutHostClimb',
					'LayoutOverflowFailure',
					'LayoutOuterMarginFailure',
					'TargetRoleSetAmbiguous',
					'TargetNameContainsMissing',
					'A11yMismatchFailure',
					'SharedHostEventIsolation',
					'ExternalFormOwner',
					'PressDisabledTargetFailure',
					'PressPrintableSpaceAndUnicode',
					'LayoutMountContainerWidth',
					'InvalidPortableTimeoutZero',
					'InvalidPortableTimeoutFloat',
					'InvalidPortableTimeoutMax',
				].map((exportName) => ({
					id: exportName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
					title: exportName,
					module: './elements.js',
					exportName,
				})),
			})
		);
		bench = await createSpecimenBench({ root });
	});

	afterAll(async () => {
		await bench?.close();
		if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
	});

	it('captures version 0.10 structured ARIA states including invalid and validates observationSchema', async () => {
		const obs: Observation = await bench.render({
			id: 'aria-states-capture',
			checkpoint: 'after-run',
		});
		expect(obs.manifest.captureVersion).toBe(CAPTURE_VERSION);
		expect(CAPTURE_VERSION).toBe('0.10');
		expect(() => observationSchema.parse(obs)).not.toThrow();

		const byName = (name: string) =>
			obs.channels.elements.find((el) => el.accessibility?.name === name);
		expect(byName('Email')?.accessibility?.states).toEqual({ invalid: true });
		expect(byName('Size')?.accessibility?.states).toEqual({ expanded: false });
		// Chromium 146's Blink AXNodeObject::GetInvalidState() normalizes authored
		// aria-invalid="grammar" and "spelling" on <input> to CDP token "true"; exact
		// "grammar"/"spelling" CDP token preservation is verified by specimen-host Rust unit tests.
		expect(byName('Grammar note')?.accessibility?.states).toEqual({
			invalid: true,
			readonly: true,
			required: true,
		});
		expect(byName('Spelling note')?.accessibility?.states).toEqual({ invalid: true });
		// Valid note has no non-default ARIA states -> states is omitted.
		expect(byName('Valid note')?.accessibility?.states).toBeUndefined();
		expect(byName('Bold')?.accessibility?.states).toEqual({ pressed: 'mixed' });
		expect(byName('Locked')?.accessibility?.states).toEqual({ disabled: true });
		expect(byName('Controls')?.accessibility?.states).toEqual({ level: 2 });
		expect(byName('All items')?.accessibility?.states).toEqual({ checked: 'mixed' });
		expect(obs.channels.evidence.expectations.every((item) => item.kind === 'a11y')).toBe(true);
	});

	it('drives press chords and host-climbs validity, form, and change events on shadow controls', async () => {
		const obs = await bench.render({
			id: 'select-keyboard-and-form-climb',
			checkpoint: 'after-run',
		});
		expect(() => observationSchema.parse(obs)).not.toThrow();
		expect(obs.channels.evidence.expectations.map((e) => [e.id, e.kind])).toEqual([
			['initial-invalid', 'validity'],
			['initial-aria-invalid', 'a11y'],
			['trigger-focused', 'focus'],
			['trigger-unfocused', 'focus'],
			['before-focused', 'focus'],
			['is-open', 'a11y'],
			['is-closed', 'a11y'],
			['focus-kept', 'focus'],
			['change-fired', 'event'],
			['form-has-pear', 'form'],
			['now-valid', 'validity'],
			['name-updated', 'a11y'],
		]);
		const focusedTrigger = obs.channels.elements.find(
			(el) => el.tag === 'button' && el.accessibility?.name.startsWith('Fruit')
		);
		expect(focusedTrigger?.state.focused).toBe(true);
	});

	it('host-climbs layout expectations to custom element host and rejects overflow/margin violations', async () => {
		const passed = await bench.render({
			id: 'field-layout-host-climb',
			checkpoint: 'after-run',
			context: { viewport: { width: 320, height: 600 } },
		});
		expect(passed.channels.evidence.expectations.find((e) => e.id === 'fits')?.kind).toBe('layout');
		const focusedInput = passed.channels.elements.find((el) => el.tag === 'input');
		expect(focusedInput?.state.focused).toBe(true);

		await expect(
			bench.render({
				id: 'layout-overflow-failure',
				checkpoint: 'after-run',
				context: { viewport: { width: 320, height: 600 } },
			})
		).rejects.toThrow(/overflow/i);

		await expect(
			bench.render({
				id: 'layout-outer-margin-failure',
				checkpoint: 'after-run',
			})
		).rejects.toThrow(/outer margins/i);
	});

	it('preserves TARGET_AMBIGUOUS and TARGET_NOT_FOUND for role sets and name matchers', async () => {
		const ambiguous = (await bench
			.render({ id: 'target-role-set-ambiguous', checkpoint: 'after-run' })
			.catch((err: unknown) => err)) as SpecimenHostError;
		expect(ambiguous.code).toBe('TARGET_AMBIGUOUS');
		expect(ambiguous.details).toEqual({ count: 2, target: 'fruit' });

		const notFound = (await bench
			.render({ id: 'target-name-contains-missing', checkpoint: 'after-run' })
			.catch((err: unknown) => err)) as SpecimenHostError;
		expect(notFound.code).toBe('TARGET_NOT_FOUND');
		expect(notFound.details).toEqual({ count: 0, target: 'missing' });

		await expect(
			bench.render({ id: 'a11y-mismatch-failure', checkpoint: 'after-run' })
		).rejects.toThrow(/a11y\.invalid/);
	});

	it('isolates shared-host events, resolves external form owners, supports expectation since ids, and checks focus/printable press/mount bounds/timeouts', async () => {
		// Shared shadow host event isolation + event.since referencing an earlier focus expectation id.
		const isolated = await bench.render({
			id: 'shared-host-event-isolation',
			checkpoint: 'after-run',
		});
		expect(isolated.channels.evidence.expectations.map((e) => e.id)).toEqual([
			'check-focus',
			'second-input',
			'first-no-input',
		]);

		// External <form id="order"> resolved for a formAssociated host without a public .form getter.
		const externalForm = await bench.render({
			id: 'external-form-owner',
			checkpoint: 'after-run',
		});
		expect(externalForm.channels.evidence.expectations.map((e) => e.id)).toEqual(['order-value']);

		// Targeted press refuses when focus cannot move to a disabled target.
		await expect(
			bench.render({ id: 'press-disabled-target-failure', checkpoint: 'after-run' })
		).rejects.toThrow(/could not receive focus/i);

		// Printable keys: literal Space (' ') and non-US Unicode ('é') fire keydown and insert text.
		const printable = await bench.render({
			id: 'press-printable-space-and-unicode',
			checkpoint: 'after-run',
		});
		expect(printable.channels.evidence.expectations.map((e) => e.id)).toEqual([
			'check-keys',
			'check-value',
		]);

		// noOverflow compares against mount container horizontal bounds (600 px) even in a 320 px viewport.
		const containerBounds = await bench.render({
			id: 'layout-mount-container-width',
			checkpoint: 'after-run',
			context: { viewport: { width: 320, height: 600 }, container: { width: 600 } },
		});
		expect(containerBounds.channels.evidence.expectations.map((e) => e.id)).toEqual(['fits-mount']);

		// Portable native expectations enforce integer timeoutMs 1..60000 matching pattern-schema.ts.
		for (const id of [
			'invalid-portable-timeout-zero',
			'invalid-portable-timeout-float',
			'invalid-portable-timeout-max',
		]) {
			await expect(bench.render({ id, checkpoint: 'after-run' })).rejects.toThrow(
				/integer between 1 and 60000/
			);
		}
	});
});

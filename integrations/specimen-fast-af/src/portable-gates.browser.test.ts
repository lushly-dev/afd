import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSpecimenBench, type SpecimenBench } from '@lushly-dev/specimen';
import { CAPTURE_VERSION } from '@lushly-dev/specimen/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const violetElements = resolve(
	import.meta.dirname,
	'../../../foundations/fast-af/packages/violet-elements/src'
);

describe('Patterns B2 portable gates on real violet-select and violet-text-field', () => {
	let root: string;
	let bench: SpecimenBench;

	beforeAll(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), 'specimen-violet-b2-')));
		const themeImport = JSON.stringify(join(violetElements, 'theme/violet-theme.ts'));
		const selectImport = JSON.stringify(join(violetElements, 'select/violet-select.ts'));
		const fieldImport = JSON.stringify(join(violetElements, 'text-field/violet-text-field.ts'));
		await writeFile(
			join(root, 'violet-gates.ts'),
			`import ${themeImport};
import ${selectImport};
import ${fieldImport};

function mount(html: string): HTMLElement {
	const host = document.createElement('violet-theme');
	host.innerHTML = html;
	return host;
}

export const VioletSelectPortable = {
	render: () =>
		mount(\`
			<form>
				<button type="button">Before</button>
				<violet-select label="Fruit" name="fruit" required>
					<violet-option value="apple">Apple</violet-option>
					<violet-option value="pear">Pear</violet-option>
				</violet-select>
			</form>
		\`),
	targets: {
		before: { role: 'button', name: 'Before' },
		trigger: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' },
	},
	events: [{ type: 'change', target: 'trigger' }],
	scenario: [
		// Host-climb validity: inner shadow <button> climbs to <violet-select>.checkValidity() === false.
		{ id: 'starts-invalid', expect: { target: 'trigger', validity: { valid: false } } },
		{ id: 'starts-closed', expect: { target: 'trigger', a11y: { role: ['combobox', 'button'], expanded: false, nameNonEmpty: true } } },
		// Tab from Before -> trigger; Shift+Tab -> Before.
		{ id: 'focus-before', action: { focus: 'before' } },
		{ id: 'tab-in', action: { press: 'Tab' } },
		{ id: 'trigger-focused', expect: { target: 'trigger', focus: true } },
		{ id: 'shift-tab-out', action: { press: 'Shift+Tab' } },
		{ id: 'trigger-blurred', expect: { target: 'trigger', focus: false } },
		// Open with click, Escape closes and returns focus to trigger.
		{ id: 'open-click', action: { click: 'trigger' } },
		{ id: 'opened', expect: { target: 'trigger', a11y: { expanded: true } } },
		{ id: 'esc-close', action: { press: 'Escape' } },
		{ id: 'closed-again', expect: { target: 'trigger', a11y: { expanded: false } } },
		{ id: 'focus-returned', expect: { target: 'trigger', focus: true } },
		// Open again, ArrowDown + Enter commits a choice -> change event + FormData + valid.
		{ id: 'reopen', action: { click: 'trigger' } },
		{ id: 'move-down', action: { press: 'ArrowDown' } },
		{ id: 'commit', action: { press: 'Enter' } },
		{ id: 'change-event', expect: { event: 'change', target: 'trigger', since: 'commit' } },
		{ id: 'form-submitted', expect: { target: 'trigger', form: { name: 'fruit', value: 'pear' } } },
		{ id: 'now-valid', expect: { target: 'trigger', validity: { valid: true } } },
		{ id: 'fits', expect: { target: 'trigger', layout: { minHeight: 24, noOverflow: true, noOuterMargin: true } } },
	],
};

export const VioletSelectInvalidCapture = {
	render: () =>
		mount(\`
			<violet-select label="Fruit" invalid>
				<violet-option value="apple">Apple</violet-option>
			</violet-select>
		\`),
	targets: {
		trigger: { role: ['combobox', 'button'], nameStartsWith: 'Fruit' },
	},
	scenario: [
		{ id: 'aria-invalid', expect: { target: 'trigger', a11y: { invalid: true, expanded: false } } },
	],
};

export const VioletTextFieldPortable = {
	render: () =>
		mount(\`
			<form>
				<violet-text-field label="Plant name" name="plant" required></violet-text-field>
			</form>
		\`),
	targets: {
		field: { role: ['textbox', 'searchbox'], nameContains: 'Plant' },
	},
	events: [
		{ type: 'input', target: 'field' },
		{ type: 'change', target: 'field' },
	],
	scenario: [
		// Inner shadow <input> (~19px) climbs to <violet-text-field> host (>= 36px) for layout & validity.
		{ id: 'required-a11y', expect: { target: 'field', a11y: { role: ['textbox', 'searchbox'], required: true, nameContains: 'Plant' } } },
		{ id: 'invalid-validity', expect: { target: 'field', validity: { valid: false } } },
		{ id: 'host-layout', expect: { target: 'field', layout: { minHeight: 24, noOverflow: true, noOuterMargin: true } } },
		{ id: 'fill-value', action: { fill: 'field', value: 'Lavender' } },
		{ id: 'is-focused', expect: { target: 'field', focus: true } },
		{ id: 'input-fired', expect: { event: 'input', target: 'field', since: 'fill-value' } },
		{ id: 'form-value', expect: { target: 'field', form: { name: 'plant', value: 'Lavender' } } },
		{ id: 'now-valid', expect: { target: 'field', validity: { valid: true } } },
	],
};

export const VioletTextFieldInvalid = {
	render: () => mount('<violet-text-field label="Plant name" invalid></violet-text-field>'),
	targets: {
		field: { role: ['textbox', 'searchbox'], nameContains: 'Plant' },
	},
	scenario: [
		{ id: 'invalid-a11y', expect: { target: 'field', a11y: { invalid: true } } },
	],
};
`
		);
		await writeFile(
			join(root, 'specimen.config.json'),
			JSON.stringify({
				specimens: [
					{
						id: 'violet-select-portable',
						title: 'Violet Select Portable',
						module: './violet-gates.ts',
						exportName: 'VioletSelectPortable',
					},
					{
						id: 'violet-select-invalid',
						title: 'Violet Select Invalid',
						module: './violet-gates.ts',
						exportName: 'VioletSelectInvalidCapture',
					},
					{
						id: 'violet-text-field-portable',
						title: 'Violet Text Field Portable',
						module: './violet-gates.ts',
						exportName: 'VioletTextFieldPortable',
					},
					{
						id: 'violet-text-field-invalid',
						title: 'Violet Text Field Invalid',
						module: './violet-gates.ts',
						exportName: 'VioletTextFieldInvalid',
					},
				],
			})
		);
		bench = await createSpecimenBench({ root });
	});

	afterAll(async () => {
		await bench?.close();
		if (root) await rm(root, { recursive: true, force: true, maxRetries: 10 });
	});

	it('runs portable press, focus, a11y, form, event, layout, and validity host-climb on violet-select', async () => {
		const obs = await bench.render({
			id: 'violet-select-portable',
			checkpoint: 'after-run',
			context: { viewport: { width: 320, height: 600 } },
		});
		expect(obs.manifest.captureVersion).toBe(CAPTURE_VERSION);
		expect(obs.channels.console.errors).toEqual([]);
		expect(obs.channels.evidence.expectations.map((e) => e.id)).toEqual([
			'starts-invalid',
			'starts-closed',
			'trigger-focused',
			'trigger-blurred',
			'opened',
			'closed-again',
			'focus-returned',
			'change-event',
			'form-submitted',
			'now-valid',
			'fits',
		]);

		const invalidObs = await bench.render({
			id: 'violet-select-invalid',
			checkpoint: 'after-run',
		});
		const trigger = invalidObs.channels.elements.find(
			(el) => el.tag === 'button' && el.accessibility?.name.startsWith('Fruit')
		);
		expect(trigger?.accessibility?.states).toMatchObject({ invalid: true, expanded: false });
	});

	it('runs portable a11y, focus, validity host-climb, layout host-climb, form, and input event on violet-text-field', async () => {
		const obs = await bench.render({
			id: 'violet-text-field-portable',
			checkpoint: 'after-run',
			context: { viewport: { width: 320, height: 600 } },
		});
		expect(obs.manifest.captureVersion).toBe(CAPTURE_VERSION);
		expect(obs.channels.console.errors).toEqual([]);
		const input = obs.channels.elements.find((el) => el.tag === 'input');
		expect(input?.state.focused).toBe(true);
		expect(input?.accessibility?.states).toMatchObject({ required: true });
		expect(obs.channels.evidence.expectations.map((e) => e.id)).toEqual([
			'required-a11y',
			'invalid-validity',
			'host-layout',
			'is-focused',
			'input-fired',
			'form-value',
			'now-valid',
		]);

		const invalidObs = await bench.render({
			id: 'violet-text-field-invalid',
			checkpoint: 'after-run',
		});
		const invalidInput = invalidObs.channels.elements.find((el) => el.tag === 'input');
		expect(invalidInput?.accessibility?.states).toMatchObject({ invalid: true });
	});
});

import type { ComponentSchema } from '@lushly-dev/specimen';
import { describe, expect, it } from 'vitest';
import { mergeFastSchema } from './schema.js';

const fast = {
	name: 'x-press',
	properties: [
		{ name: 'label', type: 'string', attribute: 'label' },
		{ name: 'disabled', type: 'boolean', attribute: 'disabled', default: false },
		{ name: 'tone', type: 'string', values: ['quiet', 'loud'] },
	],
	events: [{ name: 'press' }],
	slots: [{ name: 'after', description: 'After the label' }],
	cssProperties: [{ name: '--press-ink', default: 'black' }],
	commands: [{ id: 'x.press', label: 'Press' }],
};

describe('FAST-AF schema enrichment', () => {
	it("builds a schema from FAST's Definition Schema when the manifest has none", () => {
		expect(mergeFastSchema('x-press', undefined, fast)).toEqual({
			tag: 'x-press',
			sources: [],
			properties: [
				{ name: 'label', type: 'string', attribute: 'label' },
				{
					name: 'disabled',
					type: 'boolean',
					attribute: 'disabled',
					values: [true, false],
					default: 'false',
				},
				{ name: 'tone', type: 'string', values: ['quiet', 'loud'] },
			],
			attributes: [],
			slots: [{ name: 'after', description: 'After the label' }],
			events: [{ name: 'press' }],
			cssProperties: [{ name: '--press-ink', default: 'black' }],
			commands: [{ id: 'x.press', label: 'Press' }],
			unknown: [],
		});
	});

	it("keeps the manifest's statements and adds what the definition knows", () => {
		const base: ComponentSchema = {
			tag: 'x-press',
			sources: ['manifest'],
			properties: [
				{ name: 'tone', type: "'quiet' | 'loud' | 'shout'", values: ['quiet', 'loud', 'shout'] },
			],
			attributes: [],
			slots: [{ name: 'after' }],
			events: [],
			cssProperties: [],
			commands: [],
			unknown: ['commands'],
		};
		const merged = mergeFastSchema('x-press', base, fast);
		expect(merged.sources).toEqual(['manifest']);
		expect(merged.properties[0]).toEqual({
			name: 'tone',
			type: "'quiet' | 'loud' | 'shout'",
			values: ['quiet', 'loud', 'shout'],
		});
		expect(merged.properties.map((item) => item.name)).toEqual(['tone', 'label', 'disabled']);
		expect(merged.slots).toEqual([{ name: 'after' }]);
		expect(merged.unknown).toEqual([]);
		expect(merged.commands).toEqual([{ id: 'x.press', label: 'Press' }]);
	});

	it('keeps an attribute the manifest lists apart from its property once, on the property', () => {
		const base: ComponentSchema = {
			tag: 'x-press',
			sources: ['manifest'],
			// The manifest names the property and the attribute, but does not link them.
			properties: [{ name: 'label', description: 'The visible label.' }],
			attributes: [
				{ name: 'label', type: 'string', default: '""' },
				{ name: 'size', type: 'string' },
			],
			slots: [],
			events: [],
			cssProperties: [],
			commands: [],
			unknown: [],
		};
		const merged = mergeFastSchema('x-press', base, fast);
		expect(merged.properties.find((item) => item.name === 'label')).toEqual({
			name: 'label',
			description: 'The visible label.',
			type: 'string',
			attribute: 'label',
			default: '""',
		});
		expect(merged.attributes).toEqual([{ name: 'size', type: 'string' }]);
	});

	it('takes what the manifest says of the attribute over what it says of the property', () => {
		const base: ComponentSchema = {
			tag: 'x-press',
			sources: ['manifest'],
			properties: [{ name: 'label', description: 'Owns the label.', default: '"a"' }],
			attributes: [{ name: 'label', description: 'The visible label and accessible name.' }],
			slots: [],
			events: [],
			cssProperties: [],
			commands: [],
			unknown: [],
		};
		const merged = mergeFastSchema('x-press', base, fast);
		expect(merged.properties.find((item) => item.name === 'label')).toMatchObject({
			attribute: 'label',
			description: 'The visible label and accessible name.',
			default: '"a"',
		});
	});
});

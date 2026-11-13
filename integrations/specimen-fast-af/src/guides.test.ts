import type { GuideSourceContext } from '@lushly-dev/specimen';
import { describe, expect, it } from 'vitest';
import { attributeTaxonomy, parseJsonc, taxonomyRules } from './guides.js';

const taxonomy = {
	attributes: [
		{
			name: 'appearance',
			definition: 'Selects a visual   emphasis.',
			doNotUseFor: ['selection state', 'density or size'],
			usedBy: ['x-button'],
		},
		{ name: 'disabled', definition: 'Marks a control unavailable.' },
		{
			name: 'long',
			definition: 'd'.repeat(220),
			doNotUseFor: ['a thing', 'another thing'],
			usedBy: ['x-a'],
		},
		{ name: 'src', definition: 'An image source.', usedBy: ['x-image'] },
		{ name: 'src', definition: 'A media source.', usedBy: ['x-media', 'x-avatar'] },
	],
};

describe('FAST-AF attribute taxonomy as guide rules', () => {
	it('states each attribute once, with what it is not for, sorted by id', () => {
		expect(taxonomyRules(taxonomy)).toEqual([
			{
				id: 'taxonomy.appearance',
				text: 'Selects a visual emphasis. Not for: selection state; density or size.',
				appliesTo: { attributes: ['appearance'] },
			},
			{
				id: 'taxonomy.disabled',
				text: 'Marks a control unavailable.',
				appliesTo: { attributes: ['disabled'] },
			},
			{ id: 'taxonomy.long', text: 'd'.repeat(220), appliesTo: { attributes: ['long'] } },
			{
				id: 'taxonomy.long.not-for',
				text: 'Do not use long for: a thing; another thing.',
				appliesTo: { attributes: ['long'] },
			},
			{
				id: 'taxonomy.src.x-avatar',
				text: 'A media source.',
				appliesTo: { tags: ['x-avatar', 'x-media'] },
			},
			{ id: 'taxonomy.src.x-image', text: 'An image source.', appliesTo: { tags: ['x-image'] } },
		]);
	});

	it('takes a prefix, and refuses what it cannot state', () => {
		expect(taxonomyRules({ attributes: [taxonomy.attributes[1]] }, 'violet')[0]?.id).toBe(
			'violet.disabled'
		);
		expect(() => taxonomyRules({})).toThrow('no attributes array');
		expect(() => taxonomyRules({ attributes: [{ name: 'x' }] })).toThrow('has no definition');
		expect(() => taxonomyRules({ attributes: [{ name: 'Bad', definition: 'x' }] })).toThrow(
			'no attribute name'
		);
		expect(() =>
			taxonomyRules({
				attributes: [
					{ name: 'a', definition: 'One.' },
					{ name: 'a', definition: 'Two.' },
				],
			})
		).toThrow('names no tag');
		expect(() => taxonomyRules(taxonomy, 'Not.A.Prefix')).toThrow('cannot start a rule id');
	});

	it('reads JSONC, leaving comment markers inside strings alone', () => {
		expect(
			parseJsonc('{\n// a comment\n"a": "http://x/*y*/", /* block */ "b": "q\\"//"\n}')
		).toEqual({ a: 'http://x/*y*/', b: 'q"//' });
	});

	it('reads its file through the context Specimen gives it', async () => {
		const read: string[] = [];
		const context = {
			read: async (path: string) => {
				read.push(path);
				return JSON.stringify(taxonomy);
			},
		} as unknown as GuideSourceContext;
		const rules = await attributeTaxonomy({ file: 'data/taxonomy.jsonc' }).rules(context);
		expect(read).toEqual(['data/taxonomy.jsonc']);
		expect(rules).toHaveLength(6);
		await attributeTaxonomy().rules(context);
		expect(read[1]).toBe('attribute-taxonomy.jsonc');
	});
});

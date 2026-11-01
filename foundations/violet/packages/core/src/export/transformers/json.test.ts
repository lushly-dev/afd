import { describe, expect, it } from 'vitest';
import type { ResolvedToken } from '../../types/token.js';
import { jsonTransformer } from './json.js';

const token = (id: string, value: string | number, description?: string): ResolvedToken => ({
	id,
	value,
	resolvedValue: value,
	metadata: {
		category: 'custom',
		tier: 'semantic',
		status: 'stable',
		platforms: [],
		tags: [],
		...(description ? { description } : {}),
	},
	resolvedAt: 'test',
	inheritanceChain: ['test'],
});

const tokens = [
	token('color.brand.primary', '#0078D4', 'Brand colour'),
	token('spacing.md', 16),
	token('color.brand.secondary', '#107C10'),
];

describe('json transformer', () => {
	it('emits pretty-printed Style Dictionary JSON by default', () => {
		const json = jsonTransformer.transform(tokens);

		expect(JSON.parse(json)).toEqual({
			color: { brand: { primary: { value: '#0078D4' }, secondary: { value: '#107C10' } } },
			spacing: { md: { value: 16 } },
		});
		expect(json).toContain('\n  "color": {');
	});

	it('emits compact JSON when pretty is false', () => {
		const json = jsonTransformer.transform(tokens, { pretty: false });

		expect(json).not.toContain('\n');
		expect(JSON.parse(json).spacing.md.value).toBe(16);
	});

	it('nests every token under the prefix', () => {
		const output = JSON.parse(jsonTransformer.transform(tokens, { prefix: 'vlt' }));

		expect(Object.keys(output)).toEqual(['vlt']);
		expect(output.vlt.color.brand.primary.value).toBe('#0078D4');
	});

	it('adds description comments and categories with includeComments', () => {
		const output = JSON.parse(jsonTransformer.transform(tokens, { includeComments: true }));

		expect(output.color.brand.primary).toEqual({
			value: '#0078D4',
			comment: 'Brand colour',
			category: 'custom',
		});
		expect(output.spacing.md).not.toHaveProperty('comment');
	});

	it('drops tokens whose id would reach Object.prototype', () => {
		const output = JSON.parse(
			jsonTransformer.transform([token('color.__proto__.x', 'bad'), token('color.ok', 'good')]),
		);

		expect(output).toEqual({ color: { ok: { value: 'good' } } });
	});

	describe('transformMulti', () => {
		it('returns a single tokens.json without groupByCategory', () => {
			const files = jsonTransformer.transformMulti?.(tokens, { pretty: false });

			expect(Array.from(files?.keys() ?? [])).toEqual(['tokens.json']);
			expect(files?.get('tokens.json')).toBe(jsonTransformer.transform(tokens, { pretty: false }));
		});

		it('writes one file per category with groupByCategory', () => {
			const files = jsonTransformer.transformMulti?.(tokens, {
				groupByCategory: true,
				includeComments: true,
			});

			expect(Array.from(files?.keys() ?? [])).toEqual(['color.json', 'spacing.json']);
			const color = JSON.parse(files?.get('color.json') ?? '{}');
			expect(color.color.brand.primary.comment).toBe('Brand colour');
			expect(color).not.toHaveProperty('spacing');
			expect(JSON.parse(files?.get('spacing.json') ?? '{}')).toEqual({
				spacing: { md: { value: 16, category: 'custom' } },
			});
		});

		it('honours pretty: false for grouped files', () => {
			const files = jsonTransformer.transformMulti?.(tokens, {
				groupByCategory: true,
				pretty: false,
			});

			for (const content of files?.values() ?? []) {
				expect(content).not.toContain('\n');
			}
		});
	});
});

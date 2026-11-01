import { describe, expect, it } from 'vitest';
import type { ResolvedToken } from '../types/token.js';
import { initializeExport } from './index.js';
import { TransformerRegistry, transformerRegistry } from './registry.js';
import {
	type Transformer,
	buildNestedTokenObject,
	groupByCategory,
	tokenIdToCamel,
	tokenIdToKebab,
	tokensToNestedObject,
	tokensToStyleDictionary,
} from './transformer.js';

const token = (
	id: string,
	value: string | number,
	metadata: Partial<ResolvedToken['metadata']> = {},
): ResolvedToken => ({
	id,
	value,
	resolvedValue: value,
	metadata: {
		category: 'custom',
		tier: 'semantic',
		status: 'stable',
		platforms: [],
		tags: [],
		...metadata,
	},
	resolvedAt: 'test',
	inheritanceChain: ['test'],
});

const fake = (format: string): Transformer => ({
	format,
	fileExtension: format,
	name: `Fake ${format}`,
	transform: () => '',
});

describe('TransformerRegistry', () => {
	it('registers, looks up and lists transformers by format', () => {
		const registry = new TransformerRegistry();
		const yaml = fake('yaml');

		registry.register(yaml);

		expect(registry.has('yaml')).toBe(true);
		expect(registry.get('yaml')).toBe(yaml);
		expect(registry.list()).toEqual([{ format: 'yaml', name: 'Fake yaml', fileExtension: 'yaml' }]);
	});

	it('returns undefined and false for unknown formats', () => {
		const registry = new TransformerRegistry();
		expect(registry.get('nope')).toBeUndefined();
		expect(registry.has('nope')).toBe(false);
		expect(registry.list()).toEqual([]);
	});

	it('refuses to register a second transformer for the same format', () => {
		const registry = new TransformerRegistry();
		const first = fake('yaml');
		registry.register(first);

		expect(() => registry.register(fake('yaml'))).toThrow(
			"Transformer for format 'yaml' is already registered",
		);
		expect(registry.get('yaml')).toBe(first);
	});
});

describe('initializeExport', () => {
	it('registers every built-in format once and is safe to call again', () => {
		initializeExport();
		initializeExport();

		const formats = transformerRegistry.list().map((entry) => entry.format);
		expect(formats).toEqual(
			expect.arrayContaining([
				'json',
				'css',
				'scss',
				'typescript',
				'swift',
				'kotlin',
				'dart',
				'tailwind',
				'lua',
			]),
		);
		expect(new Set(formats).size).toBe(formats.length);
		expect(transformerRegistry.get('typescript')?.fileExtension).toBe('ts');
		expect(transformerRegistry.get('kotlin')?.fileExtension).toBe('kt');
	});
});

describe('transformer helpers', () => {
	it('converts token ids to kebab and camel case', () => {
		expect(tokenIdToKebab('color.brand.primary')).toBe('color-brand-primary');
		expect(tokenIdToCamel('color.brand.primary')).toBe('colorBrandPrimary');
		expect(tokenIdToCamel('spacing')).toBe('spacing');
	});

	it('groups tokens by their first segment, preserving order', () => {
		const groups = groupByCategory([
			token('color.a', '#000'),
			token('spacing.sm', 4),
			token('color.b', '#fff'),
		]);

		expect(Array.from(groups.keys())).toEqual(['color', 'spacing']);
		expect(groups.get('color')?.map((t) => t.id)).toEqual(['color.a', 'color.b']);
	});

	it('nests tokens into prototype-free objects', () => {
		const nested = tokensToNestedObject([token('color.brand.primary', '#0078D4')]);

		expect(nested).toEqual({ color: { brand: { primary: '#0078D4' } } });
		expect(Object.getPrototypeOf(nested)).toBeNull();
	});

	it('skips unsafe and empty paths when nesting', () => {
		const nested = buildNestedTokenObject(
			[token('color.__proto__.polluted', 'x'), token('ok', 1), token('skip', 2)],
			(t) => t.resolvedValue,
			(t) => (t.id === 'skip' ? [] : t.id.split('.')),
		);

		expect(nested).toEqual({ ok: 1 });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('lets a group win over a colliding leaf regardless of order, and the last leaf win', () => {
		const leafFirst = tokensToNestedObject([
			token('color.brand', 'leaf'),
			token('color.brand.primary', 'group'),
		]);
		const groupFirst = tokensToNestedObject([
			token('color.brand.primary', 'group'),
			token('color.brand', 'leaf'),
		]);
		const duplicate = tokensToNestedObject([token('a.b', 1), token('a.b', 2)]);

		expect(leafFirst).toEqual({ color: { brand: { primary: 'group' } } });
		expect(groupFirst).toEqual(leafFirst);
		expect(duplicate).toEqual({ a: { b: 2 } });
	});

	it('emits Style Dictionary leaves, with description and category only on request', () => {
		const tokens = [
			token('color.primary', '#000', { description: 'Main brand colour', category: 'color' }),
			token('spacing.sm', 4),
		];

		expect(tokensToStyleDictionary(tokens)).toEqual({
			color: { primary: { value: '#000' } },
			spacing: { sm: { value: 4 } },
		});
		expect(tokensToStyleDictionary(tokens, true)).toEqual({
			color: { primary: { value: '#000', comment: 'Main brand colour', category: 'color' } },
			spacing: { sm: { value: 4, category: 'custom' } },
		});
	});
});

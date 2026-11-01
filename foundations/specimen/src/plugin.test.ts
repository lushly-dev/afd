import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finiteValues, readManifest } from './manifest.js';
import { composeTokenMaps } from './plugin.js';

describe('the manifest schema source', () => {
	it('reads a tag into properties, attributes, slots, events and CSS properties', async () => {
		const manifest = JSON.parse(
			await readFile(
				resolve(import.meta.dirname, '../fixtures/plugins/custom-elements.json'),
				'utf8'
			)
		);
		const schema = readManifest(manifest).get('plain-switch');
		expect(schema).toEqual({
			tag: 'plain-switch',
			sources: ['manifest'],
			properties: [
				{ name: 'checked', type: 'boolean', values: [true, false], attribute: 'checked' },
			],
			attributes: [
				{ name: 'size', type: "'small' | 'large'", values: ['small', 'large'], default: "'small'" },
			],
			slots: [{ name: '', description: 'The label.' }],
			events: [{ name: 'change', type: 'Event' }],
			cssProperties: [{ name: '--_switch-accent', default: 'var(--fixture-accent)' }],
			commands: [],
			unknown: ['commands'],
		});
		expect(() => readManifest({})).toThrow(/modules array/);
	});

	it('derives a finite partition only from literal unions and boolean', () => {
		expect(finiteValues('\'a\' | "b" | undefined')).toEqual(['a', 'b']);
		expect(finiteValues('1 | 2 | null')).toEqual([1, 2, null]);
		expect(finiteValues('boolean | true')).toEqual([true, false]);
		expect(finiteValues('string')).toBeUndefined();
		expect(finiteValues("'a' | string")).toBeUndefined();
		expect(finiteValues(undefined)).toBeUndefined();
	});
});

describe('token maps', () => {
	it('compose and resolve alias chains to public names', () => {
		const composed = composeTokenMaps([
			{ id: 'violet', version: '1.0.0', tokens: { '--color-accent': 'color.accent' } },
			{
				id: 'fast-af',
				version: '3.0.0',
				aliases: { '--_button-bg': '--_accent', '--_accent': '--color-accent' },
			},
		]);
		expect(composed.problems).toEqual([]);
		expect(composed.versions).toEqual({ violet: '1.0.0', 'fast-af': '3.0.0' });
		expect(composed.aliases['--_button-bg']).toEqual({
			target: '--_accent',
			resolved: '--color-accent',
			map: 'fast-af',
		});
	});

	it('validate the maps together: versions, owners, ids, unresolved aliases and cycles', () => {
		const { problems, aliases } = composeTokenMaps([
			{ id: 'violet', version: '', tokens: { '--a': 'one', b: 'two' } },
			{ id: 'violet', version: '2', tokens: { '--a': 'other' } },
			{ id: 'aliases', version: '1', aliases: { '--x': '--missing', '--p': '--q', '--q': '--p' } },
		]);
		expect(problems).toEqual([
			"Token map 'violet' has no version.",
			"'b' in token map 'violet' is not a CSS variable name.",
			"Token map 'violet' is registered twice.",
			"'--a' is token 'one' in 'violet' and 'other' in 'violet'.",
			"Alias '--x' resolves to '--missing', which no map names.",
			"Alias '--p' cycles through '--p'.",
			"Alias '--q' cycles through '--q'.",
		]);
		// An unresolved alias is kept, not dropped.
		expect(aliases['--x']?.resolved).toBeNull();
	});
});

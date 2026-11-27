/**
 * Manifest profile version 3 (phase 5 specification, 9.1; P5-B1): `app-manifest.v3.json` conforms to core version 2,
 * which defines `expose.apps`, and is version 2 otherwise; one validator reads versions 1 to 3, and
 * `manifest-version-keys` refuses `expose.apps` under versions 1 and 2.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { AJV_OPTIONS, readCore, readSchema } from '../scripts/compile.mjs';
import { VERSION_THREE_KEYS } from './loam-rules.js';
import { readManifest } from './read-manifest.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;

const manifest = (version: number, expose: Record<string, boolean>) => ({
	manifest_version: version,
	protocol: 1,
	afd_contract: '1.0',
	plugin: {
		id: 'tally',
		title: 'Tally',
		version: '0.1.0',
		description: 'A count other apps may read.',
		kind: 'native',
		domains: ['tally'],
		license: 'MIT',
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace'] },
	commands: [
		{
			name: 'tally-get',
			description: 'Read the count',
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
			effects: ['plugin-state'],
			expose,
		},
	],
});

describe('P5-B1: manifest profile version 3', () => {
	it('P5-B1: conforms to core version 2, and is version 2 on it otherwise', () => {
		const three = readSchema('app-manifest', 3) as unknown as { $ref: string; $id: string };
		const two = readSchema('app-manifest', 2) as unknown as { $ref: string };
		expect(three.$ref).toBe(`${readCore(2).$id}#/$defs/manifest`);
		// Every reference to core version 1 in version 2 is to core version 2 in version 3, and nothing else differs but
		// the version, its title and description.
		const strip = (schema: unknown) => {
			const {
				$id: _id,
				title: _title,
				description: _description,
				...rest
			} = schema as Record<string, unknown>;
			return JSON.parse(
				JSON.stringify(rest)
					.replaceAll('plugin-manifest.core.v1.json', 'plugin-manifest.core.vN.json')
					.replaceAll('plugin-manifest.core.v2.json', 'plugin-manifest.core.vN.json')
			) as Record<string, { manifest_version?: unknown }>;
		};
		const [a, b] = [strip(two), strip(three)];
		expect(b.properties?.manifest_version).toEqual({ enum: [1, 2, 3] });
		delete a.properties?.manifest_version;
		delete b.properties?.manifest_version;
		expect(b).toEqual(a);
		// Compiled strictly against both cores.
		const ajv = new Ajv2020(AJV_OPTIONS);
		ajv.addSchema(readCore());
		ajv.addSchema(readCore(2));
		ajv.addSchema(readSchema('app-manifest', 2));
		const validate = ajv.compile(three);
		expect(validate(manifest(3, { palette: true, apps: true }))).toBe(true);
	});

	it('P5-B1: reads expose.apps under version 3 alone, VERSION_THREE_KEYS telling versions 1 and 2 the version', () => {
		expect(VERSION_THREE_KEYS).toEqual([{ pointer: '/commands/*/expose/apps' }]);
		const three = readManifest(manifest(3, { palette: true, apps: true }));
		expect(three.ok ? [] : three.refusals).toEqual([]);
		if (three.ok) expect(three.manifest.commands?.[0]?.expose?.apps).toBe(true);
		for (const version of [1, 2]) {
			const read = readManifest(manifest(version, { palette: true, apps: false }));
			expect(read.ok).toBe(false);
			if (read.ok) continue;
			expect(read.refusals).toEqual([
				expect.objectContaining({
					code: 'MANIFEST_SURFACE_UNAVAILABLE',
					key: 'commands[0].expose.apps',
					suggestion: 'Set manifest_version = 3.',
				}),
			]);
		}
		// Without `apps`, every version reads as it did.
		for (const version of [1, 2, 3]) {
			const read = readManifest(manifest(version, { palette: true }));
			expect(read.ok ? [] : read.refusals, String(version)).toEqual([]);
		}
	});
});

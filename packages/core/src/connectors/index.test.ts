/**
 * @fileoverview The `@lushly-dev/afd-core/connectors` subpath and the other
 * subpath exports of the core package.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as connectors from './index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface ExportConditions {
	types: string;
	import: string;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
	exports: Record<string, ExportConditions>;
};

/** The TypeScript source a `./dist/*.js` export target is compiled from. */
function sourceOf(target: string): string {
	return join(packageRoot, target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'));
}

describe('@lushly-dev/afd-core/connectors', () => {
	it('is declared in package.json and targets the connectors barrel', () => {
		expect(manifest.exports['./connectors']).toEqual({
			types: './dist/connectors/index.d.ts',
			import: './dist/connectors/index.js',
		});
		expect(sourceOf('./dist/connectors/index.js')).toBe(
			fileURLToPath(new URL('./index.ts', import.meta.url))
		);
	});

	it('exports both connectors', () => {
		expect(Object.keys(connectors).sort()).toEqual(['GitHubConnector', 'PackageManagerConnector']);
		expect(new connectors.GitHubConnector()).toBeInstanceOf(connectors.GitHubConnector);
		expect(new connectors.PackageManagerConnector('pnpm')).toBeInstanceOf(
			connectors.PackageManagerConnector
		);
	});

	it('is the only entry that exports them (the root re-exports were removed in 2.0)', () => {
		expect(root).not.toHaveProperty('GitHubConnector');
		expect(root).not.toHaveProperty('PackageManagerConnector');
	});
});

describe('core subpath exports', () => {
	it.each(Object.entries(manifest.exports))(
		'%s pairs a declaration file with its module and has a source file',
		(_subpath, conditions) => {
			expect(Object.keys(conditions)).toEqual(['types', 'import']);
			expect(conditions.types).toBe(conditions.import.replace(/\.js$/, '.d.ts'));
			expect(existsSync(sourceOf(conditions.import))).toBe(true);
		}
	);

	it('exposes browser-safe entries for command helpers and results', () => {
		expect(manifest.exports['./commands']?.import).toBe('./dist/commands.js');
		expect(manifest.exports['./result']?.import).toBe('./dist/result.js');
	});
});

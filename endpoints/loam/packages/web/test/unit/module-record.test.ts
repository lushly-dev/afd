/**
 * #2808: the shell build's module record (`scripts/module-record.mjs`), from which the desktop's third-party notices
 * learn what the shell ships. Each chunk's modules and each asset's source files, as absolute paths with forward
 * slashes and no query; the bundler's virtual modules kept as they are, for the notices to name.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bundleModules, writeModuleRecord } from '../../scripts/module-record.mjs';

const dir = mkdtempSync(join(tmpdir(), 'loam-module-record-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('#2808: the module record', () => {
	it('#2808: lists every chunk module and asset source once, sorted, with forward slashes and no query', () => {
		const root = resolve(dir, 'web');
		const zod = join(root, 'node_modules', 'zod', 'index.js');
		const polyfill = resolve(root, 'node_modules/@webcomponents/x/x.min.js');
		const modules = bundleModules(
			[
				{ type: 'chunk', moduleIds: [zod, `${zod}?commonjs-proxy`, '\0vite/preload-helper.js'] },
				{ type: 'chunk', moduleIds: ['\0rolldown/runtime.js', zod] },
				{ type: 'asset', originalFileNames: ['node_modules/@webcomponents/x/x.min.js'] },
				{ type: 'asset' },
			],
			root
		);
		expect(modules).toEqual(
			[
				'\0rolldown/runtime.js',
				'\0vite/preload-helper.js',
				polyfill.replaceAll('\\', '/'),
				zod.replaceAll('\\', '/'),
			].sort()
		);
		expect(modules.every((id) => !id.includes('\\') && !id.includes('?'))).toBe(true);
	});

	it("#2808: writes the record beside the build, naming the package that ran it, relative to the record's folder", () => {
		const file = join(dir, 'build-record', 'modules.json');
		const web = join(dir, 'web');
		writeModuleRecord(file, web, [
			join(web, 'node_modules', 'zod', 'index.js').replaceAll('\\', '/'),
			'\0vite/preload-helper.js',
		]);
		const text = readFileSync(file, 'utf8');
		expect(JSON.parse(text)).toEqual({
			resolveFrom: '../web',
			modules: ['../web/node_modules/zod/index.js', '\0vite/preload-helper.js'],
		});
		// No machine's paths: the portability gate reads the record once a build has written it.
		expect(text).not.toContain(dir.replaceAll('\\', '/'));
		expect(text).not.toContain(dir);
	});
});

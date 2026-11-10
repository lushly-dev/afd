import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceptsHtml, serveSite, sitePath } from './site.js';
import { temporaryDirectory } from './test-support.js';

const HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';

/** A data directory with a secret beside its site, and the site's files. */
async function layout() {
	const data = await temporaryDirectory();
	const site = join(data, 'public', 'site');
	await mkdir(join(site, 'assets'), { recursive: true });
	await writeFile(join(data, 'auth.sqlite'), 'secret rows');
	await writeFile(join(site, 'index.html'), '<!doctype html>');
	await writeFile(join(site, 'assets', 'index-a1.js'), 'export {};');
	await writeFile(join(site, 'a..b.txt'), 'dots');
	return { data, site, serve: serveSite(site, { fallback: 'index.html' }) };
}

describe("P6-E2: serveSite's refusals (3.5)", () => {
	it.each([
		['../auth.sqlite'],
		['../../auth.sqlite'],
		['assets/../../auth.sqlite'],
		['%2e%2e/auth.sqlite'],
		['%2E%2E/auth.sqlite'],
		['.%2e/auth.sqlite'],
		['%252e%252e/auth.sqlite'],
		['..%2fauth.sqlite'],
		['assets%2f..%2f..%2fauth.sqlite'],
		['..%5cauth.sqlite'],
		['..\\auth.sqlite'],
		['assets\\index-a1.js'],
		['index.html%00'],
		['index.html\0'],
		['a..b.txt'],
		['%E0%A4%A'],
	])('P6-E2: refuses %j with a 404, whatever the request accepts', async (path) => {
		const { serve } = await layout();
		for (const accept of [undefined, HTML])
			expect(await serve({ method: 'GET', path, accept })).toEqual({ status: 404, refused: true });
	});

	it('P6-E2: refuses a symbolic link in the site that points out of it', async () => {
		const { data, site, serve } = await layout();
		await symlink(join(data, 'auth.sqlite'), join(site, 'leak.sqlite'));
		await symlink(data, join(site, 'up'));
		for (const accept of [undefined, HTML]) {
			expect(await serve({ method: 'GET', path: 'leak.sqlite', accept })).toEqual({
				status: 404,
				refused: true,
			});
			expect(await serve({ method: 'GET', path: 'up/auth.sqlite', accept })).toEqual({
				status: 404,
				refused: true,
			});
		}
	});

	it('P6-E2: follows a symbolic link that stays inside the site', async () => {
		const { site, serve } = await layout();
		await symlink(join(site, 'assets', 'index-a1.js'), join(site, 'alias.js'));
		expect(await serve({ method: 'GET', path: 'alias.js' })).toMatchObject({
			status: 200,
			file: join(site, 'assets', 'index-a1.js'),
		});
	});

	it('P6-E2: measures every answer against the site as resolved once, when its root is a link', async () => {
		const { data, site } = await layout();
		const linked = join(data, 'linked-site');
		await symlink(site, linked);
		const serve = serveSite(linked, { fallback: 'index.html' });
		expect(await serve({ method: 'GET', path: 'assets/index-a1.js' })).toMatchObject({
			status: 200,
		});
		expect(await serve({ method: 'GET', path: '../auth.sqlite' })).toEqual({
			status: 404,
			refused: true,
		});
	});

	it('P6-E2: serves a file, then index.html with 200 for a path with no file to a request naming text/html (D74)', async () => {
		const { site, serve } = await layout();
		expect(await serve({ method: 'GET', path: 'assets/index-a1.js' })).toEqual({
			status: 200,
			file: join(site, 'assets', 'index-a1.js'),
			path: 'assets/index-a1.js',
			fallback: false,
		});
		expect(await serve({ method: 'HEAD', path: 'assets/index-a1.js' })).toMatchObject({
			status: 200,
		});
		for (const path of [
			'',
			'acme',
			'acme/p/atlas/hello',
			'assets',
			'assets/',
			'v1.2.3',
			'~/join',
		]) {
			expect(await serve({ method: 'GET', path, accept: HTML }), path).toEqual({
				status: 200,
				file: join(site, 'index.html'),
				path,
				fallback: true,
			});
			expect(await serve({ method: 'GET', path, accept: '*/*' }), path).toEqual({
				status: 404,
				refused: false,
			});
		}
	});

	it('P6-E2: answers only GET and HEAD', async () => {
		const { serve } = await layout();
		for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS'])
			expect(await serve({ method, path: 'index.html', accept: HTML }), method).toEqual({
				status: 404,
				refused: false,
			});
	});

	it('P6-E2: has no fallback unless it is given one', async () => {
		const { site } = await layout();
		const serve = serveSite(site);
		expect(await serve({ method: 'GET', path: 'acme', accept: HTML })).toEqual({
			status: 404,
			refused: false,
		});
	});
});

describe('the parts of serveSite', () => {
	it('decodes a path once', () => {
		expect(sitePath('a%20b/c.js')).toBe('a b/c.js');
		expect(sitePath('%7E/join')).toBe('~/join');
		expect(sitePath('%25')).toBe('%');
		expect(sitePath('%252e')).toBeUndefined();
		expect(sitePath('%')).toBeUndefined();
	});

	it('reads text/html from Accept, never */*', () => {
		expect(acceptsHtml(HTML)).toBe(true);
		expect(acceptsHtml('TEXT/HTML; q=0.5')).toBe(true);
		expect(acceptsHtml('*/*')).toBe(false);
		expect(acceptsHtml('application/json, text/*')).toBe(false);
		expect(acceptsHtml(undefined)).toBe(false);
	});
});

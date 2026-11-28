/**
 * What a public page on afd.dev must say (#2764). scripts/check-site.mjs already keeps
 * `site/sitemap.xml` equal to the indexable pages; this test names which pages are meant to be
 * public, so a public page that gains `noindex` fails here instead of quietly leaving the sitemap.
 * A public page has no "proposal" in its title, names Agent-First Development or Agent-First
 * Design in it, and says near its opening that AFD is not agents writing code. Every other page
 * (a redirect, the 404 page, or a working page such as the style guide) carries `noindex`, and a
 * working page says so where a visitor reads it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { htmlPages, noindex, pageUrl, sitemapUrls } from './check-site.mjs';

const site = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'site');

/** Pages that are not public, and why. A page not named here is public. */
const NOT_PUBLIC = new Map([
	['404.html', 'error'],
	['manifesto-2.html', 'redirect'],
	['manifesto-3.html', 'redirect'],
	['styleguide.html', 'working'],
	['fast-af/review/index.html', 'working'],
	['fast-af/review/in-use.html', 'working'],
	['fast-af/review/spinner.html', 'working'],
]);

const pages = htmlPages(site);
const title = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const listed = new Set(sitemapUrls(readFileSync(join(site, 'sitemap.xml'), 'utf8')));

describe('site indexing', () => {
	it('names only pages that exist', () => {
		for (const page of NOT_PUBLIC.keys())
			assert.ok(pages.includes(page), `${page} is not in site/`);
	});

	for (const page of pages) {
		const html = readFileSync(join(site, page), 'utf8');
		const kind = NOT_PUBLIC.get(page);
		if (kind) {
			it(`${page} is a ${kind} page and is not indexed`, () => {
				assert.ok(noindex(html), `${page} needs <meta name="robots" content="noindex">`);
				assert.ok(!listed.has(pageUrl(page)), `${page} is in sitemap.xml`);
				if (kind === 'working')
					assert.match(html, /A working page\b/, `${page} must say it is a working page`);
			});
			continue;
		}
		it(`${page} is public and indexable`, () => {
			assert.ok(!noindex(html), `${page} carries noindex; a public page must not`);
			assert.ok(listed.has(pageUrl(page)), `${pageUrl(page)} is missing from site/sitemap.xml`);
			assert.doesNotMatch(title(html), /proposal/i, `${page}'s title still says proposal`);
			assert.match(
				html.replace(/<head>[\s\S]*?<\/head>/i, ''),
				/not (AI that writes|agents writing)/i,
				`${page} must say near its opening that AFD is not agents writing code`
			);
			assert.match(
				title(html),
				/Agent-First (Development|Design)/,
				`${page}'s title must name Agent-First Development or Agent-First Design`
			);
		});
	}
});

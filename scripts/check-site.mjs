#!/usr/bin/env node
/**
 * Facts on afd.dev (site/) that can drift from the repository (#2690).
 *
 *   - Every `data-conformance-cases` element on the site, and llms.txt's "N-case conformance
 *     suite", states the number of cases in the todo conformance suite
 *     (packages/examples/todo/spec/test-cases.json).
 *   - sitemap.xml lists exactly the pages a search engine may index: every HTML page under
 *     site/ that is not marked `noindex`, does not redirect, and is not 404.html.
 *   - robots.txt names the sitemap, and 404.html exists.
 *
 * Usage: node scripts/check-site.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGIN = 'https://afd.dev';
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

/** Every .html file under `dir`, as paths relative to it with forward slashes. */
export function htmlPages(dir) {
	const out = [];
	const walk = (at) => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(at, entry.name));
			} else if (entry.name.endsWith('.html')) {
				out.push(relative(dir, join(at, entry.name)).split(sep).join('/'));
			}
		}
	};
	walk(dir);
	return out.sort();
}

/** Whether a page may be indexed: not noindex, not a redirect, not the 404 page. */
export function isIndexable(path, html) {
	if (path === '404.html') return false;
	if (/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) return false;
	if (/<meta\s+http-equiv=["']refresh["']/i.test(html)) return false;
	const head = html.split(/<\/head>/i)[0];
	return !/location\.replace\(/.test(head);
}

/** The public URL GitHub Pages serves a page at. */
export function pageUrl(path) {
	if (path === 'index.html') return `${ORIGIN}/`;
	if (path.endsWith('/index.html')) return `${ORIGIN}/${path.slice(0, -'index.html'.length)}`;
	return `${ORIGIN}/${path}`;
}

export function sitemapUrls(xml) {
	return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/** Every problem found, as messages; empty when the site agrees with the repository. */
export function checkSite({ siteDir, caseCount }) {
	const problems = [];
	const pages = htmlPages(siteDir);
	let counted = 0;

	for (const path of pages) {
		const html = readFileSync(join(siteDir, path), 'utf8');
		for (const m of html.matchAll(/<([a-z0-9]+)[^>]*\bdata-conformance-cases\b[^>]*>([^<]*)</gi)) {
			counted++;
			if (m[2].trim() !== String(caseCount)) {
				problems.push(
					`site/${path}: a data-conformance-cases element says "${m[2].trim()}", but the suite has ${caseCount} cases. Write ${caseCount}.`
				);
			}
		}
	}

	// A count reworded away from its marker would otherwise pass unchecked.
	if (counted === 0) {
		problems.push(
			'site/: no data-conformance-cases element found. Mark the conformance count so it is checked.'
		);
	}

	const llmsPath = join(siteDir, 'llms.txt');
	if (existsSync(llmsPath)) {
		const counts = [...readFileSync(llmsPath, 'utf8').matchAll(/(\d+)-case conformance suite/g)];
		if (counts.length === 0) {
			problems.push(
				'site/llms.txt: no "N-case conformance suite" found. State the count in that form so it is checked.'
			);
		}
		for (const m of counts) {
			if (Number(m[1]) !== caseCount) {
				problems.push(
					`site/llms.txt: says a ${m[1]}-case conformance suite, but it has ${caseCount} cases.`
				);
			}
		}
	}

	const sitemapPath = join(siteDir, 'sitemap.xml');
	if (!existsSync(sitemapPath)) {
		problems.push('site/sitemap.xml is missing.');
	} else {
		const listed = new Set(sitemapUrls(readFileSync(sitemapPath, 'utf8')));
		const expected = new Set(
			pages.filter((p) => isIndexable(p, readFileSync(join(siteDir, p), 'utf8'))).map(pageUrl)
		);
		for (const url of expected) {
			if (!listed.has(url)) problems.push(`site/sitemap.xml: add ${url}, an indexable page.`);
		}
		for (const url of listed) {
			if (!expected.has(url)) {
				problems.push(
					`site/sitemap.xml: remove ${url}; it is not an indexable page (missing, noindex or a redirect).`
				);
			}
		}
	}

	const robotsPath = join(siteDir, 'robots.txt');
	if (!existsSync(robotsPath)) {
		problems.push('site/robots.txt is missing.');
	} else if (!readFileSync(robotsPath, 'utf8').includes(`Sitemap: ${ORIGIN}/sitemap.xml`)) {
		problems.push(`site/robots.txt: add the line "Sitemap: ${ORIGIN}/sitemap.xml".`);
	}

	if (!existsSync(join(siteDir, '404.html'))) problems.push('site/404.html is missing.');
	return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const suite = JSON.parse(
		readFileSync(join(REPO_ROOT, 'packages/examples/todo/spec/test-cases.json'), 'utf8')
	);
	const problems = checkSite({ siteDir: join(REPO_ROOT, 'site'), caseCount: suite.tests.length });
	if (problems.length) {
		for (const p of problems) console.error(`✗ ${p}`);
		process.exit(1);
	}
	console.log(`✓ site facts agree with the repository (${suite.tests.length} conformance cases)`);
}

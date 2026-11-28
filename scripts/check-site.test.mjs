import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { checkSite, isIndexable, noindex, pageUrl } from './check-site.mjs';

const temps = [];
after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A site folder holding `files` ({ path: content }). */
function site(files) {
	const dir = mkdtempSync(join(tmpdir(), 'afd-site-'));
	temps.push(dir);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	return dir;
}

const page = (body = '', head = '') =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const sitemap = (...urls) =>
	`<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
const complete = {
	'index.html': page('<span data-conformance-cases>50</span> cases'),
	'tool/index.html': page(),
	'hidden/index.html': page('', '<meta name="robots" content="noindex">'),
	'old.html': page('', '<script>location.replace("./")</script>'),
	'404.html': page(),
	'llms.txt': 'a 50-case conformance suite runs in CI',
	'robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://afd.dev/sitemap.xml\n',
	'sitemap.xml': sitemap('https://afd.dev/', 'https://afd.dev/tool/'),
};

test('a site that agrees with the repository has no problems', () => {
	assert.deepEqual(checkSite({ siteDir: site(complete), caseCount: 50 }), []);
});

test('a stale conformance count on a page or in llms.txt is refused', () => {
	const problems = checkSite({ siteDir: site(complete), caseCount: 51 });
	assert.equal(problems.length, 2);
	assert.match(problems[0], /index\.html.*says "50".*51 cases/);
	assert.match(problems[1], /llms\.txt.*50-case.*51 cases/);
});

test('a conformance count without its marker is refused, not passed', () => {
	const problems = checkSite({
		siteDir: site({
			...complete,
			'index.html': page('50 cases'),
			'llms.txt': 'a conformance suite of fifty cases',
		}),
		caseCount: 50,
	});
	assert.equal(problems.length, 2);
	assert.match(problems[0], /no data-conformance-cases element/);
	assert.match(problems[1], /llms\.txt: no "N-case conformance suite"/);
});

test('the sitemap must list every indexable page and nothing else', () => {
	const problems = checkSite({
		siteDir: site({
			...complete,
			'sitemap.xml': sitemap('https://afd.dev/', 'https://afd.dev/hidden/'),
		}),
		caseCount: 50,
	});
	assert.deepEqual(problems, [
		'site/sitemap.xml: add https://afd.dev/tool/, an indexable page.',
		'site/sitemap.xml: remove https://afd.dev/hidden/; it is not an indexable page (missing, noindex or a redirect).',
	]);
});

test('robots.txt, sitemap.xml and 404.html must exist', () => {
	const { 'robots.txt': _r, 'sitemap.xml': _s, '404.html': _n, ...rest } = complete;
	const problems = checkSite({ siteDir: site(rest), caseCount: 50 });
	assert.deepEqual(problems, [
		'site/sitemap.xml is missing.',
		'site/robots.txt is missing.',
		'site/404.html is missing.',
	]);
});

test('robots.txt must name the sitemap', () => {
	const problems = checkSite({
		siteDir: site({ ...complete, 'robots.txt': 'User-agent: *\n' }),
		caseCount: 50,
	});
	assert.deepEqual(problems, [
		'site/robots.txt: add the line "Sitemap: https://afd.dev/sitemap.xml".',
	]);
});

test('pages map to the URLs GitHub Pages serves', () => {
	assert.equal(pageUrl('index.html'), 'https://afd.dev/');
	assert.equal(pageUrl('violet/index.html'), 'https://afd.dev/violet/');
	assert.equal(pageUrl('styleguide.html'), 'https://afd.dev/styleguide.html');
	assert.equal(isIndexable('404.html', page()), false);
	assert.equal(
		isIndexable('a.html', page('', '<meta http-equiv="refresh" content="0; url=/">')),
		false
	);
	assert.equal(isIndexable('a.html', page('<script>location.replace("/")</script>')), true);
});

test('noindex reads the robots tag in any attribute order and quoting', () => {
	assert.ok(noindex('<meta name="robots" content="noindex">'));
	assert.ok(noindex(`<meta content='noindex, follow' name=robots>`));
	assert.ok(noindex('<META NAME="Robots" CONTENT="NOINDEX">'));
	assert.ok(!noindex('<meta name="description" content="noindex">'));
	assert.ok(!noindex('<meta name="robots" content="index, follow">'));
	assert.equal(isIndexable('a.html', page('', `<meta content="noindex" name="robots">`)), false);
});

#!/usr/bin/env node
// The proofs of the twelve faults (faults.md): each says whether its fault is present in a build.
// Run on both builds before the first walk; every proof must be absent on the clean build and
// present on the seeded one.
//
//   node fault-proofs.mjs <build root> [F1,F2,...]
//
// <build root> is the reference build or its seeded copy: its `server.mjs` serves its `build/`,
// built with `tools/build-app.mjs`. Playwright comes from the runner's scoring checkout. The
// states are reached by keys (focus, then Enter or Space), which no fault touches, so a pointer
// fault never stops the way to another fault's state. Prints one JSON object: per fault,
// `present` and what was measured.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '');
const only = process.argv[3]?.split(',');
const config = JSON.parse(readFileSync(process.env.BENCH_CONFIG ?? 'bench.config.json', 'utf8'));
const require = createRequire(join(config.scoreRoot, 'foundations/specimen/package.json'));
const { chromium } = require('playwright');

const port = await new Promise((done) => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address();
		probe.close(() => done(port));
	});
});
const journal = join(mkdtempSync(join(tmpdir(), 'fault-proofs-')), 'journal.jsonl');
const server = spawn(process.execPath, [join(root, 'server.mjs'), '--journal', journal, '--port', String(port)], {
	stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((done) => server.stdout.once('data', done));

const browser = await chromium.launch();
const results = {};

/** Code run in the page: walking the composed tree. */
const IN_PAGE = `
window.__deepFocus = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
window.__inside = (host, node) => { for (let n = node; n; n = n.parentNode ?? n.host) if (n === host) return true; return false; };
window.__hit = (x, y) => { let e = document.elementFromPoint(x, y); while (e?.shadowRoot) { const d = e.shadowRoot.elementFromPoint(x, y); if (!d || d === e) break; e = d; } return e; };
window.__ancestors = (node) => { const out = []; for (let n = node.parentNode ?? node.host; n && n !== document; n = n.parentNode ?? n.host) if (n.nodeType === 1) out.push(n); return out; };
window.__key = (k) => document.querySelector('[data-key="' + k + '"]');
`;

async function open(screen, width = 1280) {
	const page = await browser.newPage({ viewport: { width, height: 800 } });
	await page.addInitScript(IN_PAGE);
	await page.goto(`http://127.0.0.1:${port}/?screen=${screen}`);
	await page.waitForSelector('html[data-ready="true"]');
	await page.waitForTimeout(600);
	return page;
}

const settle = (page) => page.waitForTimeout(700);

/** Focuses a keyed control in code and presses a key on it: the way through to a state. */
async function press(page, key, which = 'Enter') {
	await page.evaluate((k) => __key(k).focus(), key);
	await page.keyboard.press(which);
	await settle(page);
}

/** Types into a keyed field. */
async function type(page, key, text) {
	await page.evaluate((k) => __key(k).focus(), key);
	await page.keyboard.type(text);
}

/**
 * Puts the start of sequential focus at the top of the page: a click in its empty top-left corner,
 * which blurring alone does not do.
 */
async function fromTheTop(page) {
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.mouse.click(2, 2);
	await page.mouse.move(0, 0);
}

/** Tabs from the top of the page until focus is inside the keyed control; false if never. */
async function tabTo(page, key, limit = 200) {
	await fromTheTop(page);
	for (let i = 0; i < limit; i++) {
		await page.keyboard.press('Tab');
		if (await page.evaluate((k) => __inside(__key(k), __deepFocus()), key)) {
			// The components ease their colours in: measure what focus settles on.
			await page.waitForTimeout(600);
			return true;
		}
	}
	return false;
}

async function memberFound(page) {
	await type(page, 'member-search', 'Ines');
	await press(page, 'member-find');
}

async function outOfStock(page) {
	await memberFound(page);
	await press(page, 'lend-var-runner');
}

async function substitutesOffered(page) {
	await outOfStock(page);
	await press(page, 'find-substitute');
}

async function batch(page) {
	await press(page, 'choose-all', 'Space');
	await press(page, 'approve-chosen');
	await page.waitForTimeout(800);
}

/** The accessibility tree under a DOM element (by selector), as the names, descriptions and values said. */
async function spoken(page, selector) {
	const cdp = await page.context().newCDPSession(page);
	const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
	if (!result.objectId) return null;
	const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
	const { nodes } = await cdp.send('Accessibility.getFullAXTree');
	const byId = new Map(nodes.map((n) => [n.nodeId, n]));
	const start = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
	if (!start) return { words: [], hidden: true };
	const words = [];
	const visit = (n) => {
		if (!n) return;
		if (!n.ignored) for (const p of [n.name, n.description, n.value]) if (p?.value) words.push(String(p.value));
		for (const id of n.childIds ?? []) visit(byId.get(id));
	};
	visit(start);
	await cdp.detach();
	return { words };
}

async function checkboxNames(page) {
	const cdp = await page.context().newCDPSession(page);
	const { nodes } = await cdp.send('Accessibility.getFullAXTree');
	await cdp.detach();
	return nodes.filter((n) => !n.ignored && n.role?.value === 'checkbox').map((n) => n.name?.value ?? '');
}

const proofs = {
	async F1() {
		const page = await open('t1');
		await memberFound(page);
		const keys = await page.evaluate(() => [...document.querySelectorAll('[data-key^="lend-var-"]')].map((e) => e.dataset.key));
		const rows = [];
		for (const key of keys) {
			await page.evaluate((k) => __key(k).scrollIntoView({ block: 'center' }), key);
			rows.push(
				await page.evaluate((k) => {
					const c = __key(k);
					const r = c.getBoundingClientRect();
					const hit = __hit(r.x + r.width / 2, r.y + r.height / 2);
					return { key: k, onControl: __inside(c, hit), hit: hit ? `${hit.localName}.${hit.className}` : null };
				}, key)
			);
		}
		const covered = rows.filter((r) => !r.onControl);
		await page.close();
		return { present: rows.length > 0 && covered.length === rows.length, rows: rows.length, covered: covered.length, runner: rows.find((r) => r.key === 'lend-var-runner') };
	},

	async F2() {
		const page = await open('t2');
		const rows = await page.evaluate(() =>
			[...document.querySelectorAll('[data-key$="-leave"]')].map((c) => {
				const r = c.getBoundingClientRect();
				const clip = __ancestors(c).find((a) => ['hidden', 'clip'].some((v) => [getComputedStyle(a).overflowX, getComputedStyle(a).overflowY].includes(v)));
				const b = clip?.getBoundingClientRect();
				const outside = b ? r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right : false;
				const inner = c.shadowRoot?.querySelector('[part="control"]') ?? c;
				const tabbable = inner.tabIndex >= 0 && !inner.disabled && !c.hasAttribute('disabled');
				return { key: c.dataset.key, clipped: Boolean(clip), outside, tabbable };
			})
		);
		await page.close();
		const squash = rows.find((r) => r.key === 'fix-2-leave');
		return { present: Boolean(squash?.outside && squash.tabbable), rows };
	},

	async F3() {
		const page = await open('t3');
		const box = await page.evaluate(() => {
			const c = __key('return-loan-1');
			c.scrollIntoView({ block: 'center' });
			const r = c.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
		await page.mouse.click(box.x, box.y);
		await settle(page);
		const opened = await page.evaluate(() => Boolean(__key('return-packets')));
		await page.close();
		return { present: !opened, formOpenedByOneClick: opened };
	},

	async F4() {
		const states = {};
		for (const [name, reach] of [['out-of-stock', outOfStock], ['substitutes-offered', substitutesOffered]]) {
			const page = await open('t1');
			await reach(page);
			const reached = await tabTo(page, 'join-waitlist');
			const look = await page.evaluate(() => {
				const c = __key('join-waitlist');
				const drawn = c.shadowRoot?.querySelector('[part="control"]') ?? c;
				const s = getComputedStyle(drawn);
				return { color: s.color, background: s.backgroundColor, border: s.borderTopColor, outline: s.outlineColor };
			});
			const clear = (v) => v === 'transparent' || /rgba\(.*,\s*0\)$/.test(v);
			states[name] = { reached, ...look, vanished: reached && Object.values(look).every(clear) };
			await page.close();
		}
		return { present: Object.values(states).every((s) => s.vanished), states };
	},

	async F5() {
		const page = await open('t2');
		const read = (k) =>
			page.evaluate((key) => {
				const c = __key(key);
				const drawn = c.shadowRoot?.querySelector('[part="control-frame"]') ?? c.shadowRoot?.querySelector('[part="control"]') ?? c;
				const s = getComputedStyle(drawn);
				return [s.outlineStyle, s.outlineColor, s.outlineWidth, s.boxShadow, s.borderTopColor, s.borderTopWidth, s.backgroundColor].join(' | ');
			}, k);
		// The control as drawn, with room around it for a ring: the pixels, not the styles, so a
		// highlight on the text that Tab selects counts too.
		const shot = async (k) => {
			const r = await page.evaluate((key) => {
				const b = __key(key).getBoundingClientRect();
				return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: b.width + 16, height: b.height + 16 };
			}, k);
			return page.screenshot({ clip: r });
		};
		// Pixels that change by more than 16 levels in a channel: a ring or a highlight changes
		// hundreds; rendering noise changes a few by one.
		const changed = (a, b) =>
			page.evaluate(
				async ([a, b]) => {
					const load = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.src = src; });
					const data = (i) => { const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
					const [da, db] = (await Promise.all([load(a), load(b)])).map(data);
					let n = 0;
					for (let p = 0; p < da.length; p += 4) if (Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2])) > 16) n++;
					return n;
				},
				[a, b].map((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
			);
		const each = {};
		for (const key of ['fix-1-harvestYear', 'fix-1-send']) {
			await page.evaluate((k) => __key(k).scrollIntoView({ block: 'center' }), key);
			await fromTheTop(page);
			await page.evaluate((k) => __key(k).scrollIntoView({ block: 'center' }), key);
			await page.waitForTimeout(600);
			const before = await read(key);
			const pixelsBefore = await shot(key);
			const reached = await tabTo(page, key);
			const after = await read(key);
			const pixelsChanged = await changed(pixelsBefore, await shot(key));
			each[key] = { reached, same: reached && before === after && pixelsChanged === 0, pixelsChanged, before, after };
		}
		await page.close();
		return { present: Object.values(each).every((e) => e.same), each };
	},

	async F6() {
		const page = await open('t3');
		await press(page, 'return-loan-1');
		// From the top of the page, so where opening the form put focus does not count.
		await fromTheTop(page);
		const reached = [];
		for (let i = 0; i < 120 && reached.length < 2; i++) {
			await page.keyboard.press('Tab');
			const at = await page.evaluate(() => ['return-packets', 'return-year'].find((k) => __key(k) && __inside(__key(k), __deepFocus())));
			if (at && !reached.includes(at)) reached.push(at);
		}
		const drawn = await page.evaluate(() =>
			['return-packets', 'return-year']
				.map((k) => ({ k, r: __key(k).getBoundingClientRect() }))
				.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
				.map((e) => e.k)
		);
		await page.close();
		const reversed = reached.length === 2 && reached[0] === drawn[1] && reached[1] === drawn[0];
		return { present: reversed, tabOrder: reached, drawnOrder: drawn };
	},

	async F7() {
		const states = {};
		for (const [name, reach] of [['out-of-stock', outOfStock], ['substitutes-offered', substitutesOffered]]) {
			const page = await open('t1', 320);
			await reach(page);
			states[name] = await page.evaluate(() => {
				const c = __key('join-waitlist');
				const r = c.getBoundingClientRect();
				const clip = __ancestors(c).find((a) => getComputedStyle(a).overflowX === 'clip');
				const b = clip?.getBoundingClientRect();
				const subs = [...document.querySelectorAll('[data-key^="lend-sub-"]')].map((e) => ({ key: e.dataset.key, left: e.getBoundingClientRect().left }));
				return { container: clip ? `${clip.localName}.${clip.className}` : null, controlLeft: r.left, containerRight: b?.right ?? null, cut: Boolean(clip) && r.left >= b.right, substitutesCut: subs.every((x) => b && x.left >= b.right), substitutes: subs.length };
			});
			await page.close();
		}
		return { present: Object.values(states).every((s) => s.cut), states };
	},

	async F8() {
		// The reasons the failed rows give, as the results word them, and the screen's own words for them.
		const REASONS = [/harvest year 2031 is in the future/i, /does not keep a variety called Mystery squash/i, /2030 or earlier/i, /choose a variety the library keeps/i];
		const drawn = async (width) => {
			const page = await open('t2', width);
			const found = await page.evaluate((sources) => {
				const res = sources.map((s) => new RegExp(s, 'i'));
				const box = document.querySelector('[data-key="box-heading"]')?.closest('section') ?? document.querySelector('main');
				// Every element in the box, inside components' shadow roots too.
				const all = [];
				const walk = (root) => {
					for (const el of root.querySelectorAll('*')) {
						all.push(el);
						if (el.shadowRoot) walk(el.shadowRoot);
					}
				};
				walk(box);
				const text = (el) => (el.shadowRoot ? `${el.textContent} ${el.shadowRoot.textContent}` : el.textContent);
				const says = (el) => res.some((re) => re.test(text(el)));
				const kids = (el) => [...el.children, ...(el.shadowRoot ? el.shadowRoot.children : [])];
				const shown = [];
				for (const el of all) {
					if (['STYLE', 'SCRIPT'].includes(el.tagName) || !says(el) || kids(el).some(says)) continue;
					const r = el.getBoundingClientRect();
					const hidden = el.closest('.ref-visually-hidden, [aria-hidden="true"]') || r.width < 2 || r.height < 2;
					if (el.checkVisibility() && !hidden) shown.push(el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
				}
				return [...new Set(shown)];
			}, REASONS.map((re) => re.source));
			await page.close();
			return found;
		};
		const narrow = await drawn(320);
		const wide = await drawn(1280);
		return { present: narrow.length === 0 && wide.length > 0, at320: narrow, at1280: wide };
	},

	async F9() {
		const page = await open('t3', 320);
		await press(page, 'return-loan-1');
		const m = await page.evaluate(() => {
			const c = __key('return-record');
			const r = c.getBoundingClientRect();
			const clip = __ancestors(c).find((a) => getComputedStyle(a).overflowY === 'clip');
			const b = clip?.getBoundingClientRect();
			return { box: clip ? `${clip.localName}[${clip.dataset.key ?? ''}]` : null, controlTop: r.top, boxBottom: b?.bottom ?? null, below: Boolean(clip) && r.top >= b.bottom };
		});
		await page.close();
		return { present: m.below, ...m };
	},

	async F10() {
		const page = await open('t4');
		const names = await checkboxNames(page);
		await page.close();
		return { present: names.length >= 4 && names.every((n) => n === 'Select'), names };
	},

	async F11() {
		const page = await open('t4');
		await batch(page);
		const m = await page.evaluate(() => {
			const title = __key('outcome')?.querySelector('[id]')?.textContent?.trim() ?? '';
			const live = [...document.querySelectorAll('[role="status"], [role="alert"], [role="log"], [aria-live]')].filter(
				(e) => e.getAttribute('aria-live') !== 'off'
			);
			const said = live.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
			const outcome = __key('outcome');
			const own = outcome ? [outcome, ...__ancestors(outcome)].some((e) => ['status', 'alert', 'log'].includes(e.getAttribute('role')) || (e.getAttribute('aria-live') ?? 'off') !== 'off') : false;
			return { title, said, ownLive: own };
		});
		await page.close();
		const told = m.ownLive || m.said.some((s) => /requests? approved|not approved/i.test(s));
		return { present: Boolean(m.title) && !told, ...m };
	},

	async F12() {
		const page = await open('t4');
		await batch(page);
		const row = await page.evaluate(() => {
			const box = __key('choose-req-3');
			const tr = box?.closest('tr, li, [role="row"]');
			if (tr) tr.dataset.proofRow = '';
			const item = __key('batch-req-3');
			if (item) item.dataset.proofItem = '';
			const short = [...document.querySelectorAll('main li, main p')].find((e) => /none left for \d+ request/i.test(e.textContent));
			if (short) short.dataset.proofShort = '';
			return { drawn: tr?.innerText.replace(/\s+/g, ' ').trim() ?? '', item: Boolean(item), short: Boolean(short) };
		});
		const entries = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
		const failedEntry = entries.findLast((e) => e.command === 'afd-batch')?.result?.results?.find((r) => !r.result.success);
		const message = failedEntry?.result?.error?.message ?? '';
		const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const WORDS = [/\bfail\b/i, /\bfailed\b/i, /\bnot\b/i, /\bno packets\b/i, /\bout of stock\b/i, ...(message ? [new RegExp(escape(message.replace(/\.$/, '')), 'i')] : [])];
		const heard = {};
		for (const [name, sel] of [['row', '[data-proof-row]'], ['item', '[data-proof-item]'], ['short', '[data-proof-short]']]) {
			const s = await spoken(page, sel);
			heard[name] = s ? s.words.filter((w) => WORDS.some((re) => re.test(w))) : [];
		}
		await page.close();
		const drawnSaysWhy = /none left/i.test(row.drawn);
		return { present: Boolean(message) && drawnSaysWhy && Object.values(heard).every((w) => w.length === 0), message, drawn: row.drawn, heard };
	},
};

try {
	for (const [id, proof] of Object.entries(proofs)) {
		if (only && !only.includes(id)) continue;
		try {
			results[id] = await proof();
		} catch (error) {
			results[id] = { present: null, error: String(error.message ?? error).split('\n')[0] };
		}
	}
} finally {
	await browser.close();
	server.kill();
}
console.log(JSON.stringify({ root, results }, null, '\t'));

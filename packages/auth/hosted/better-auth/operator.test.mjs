/** Real local HTTPS/OAuth integration for the regular-browser operator controls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildFixture } from './build.mjs';

const authDirectory = fileURLToPath(new URL('../..', import.meta.url));
const revision = '718d7830ab813b0975429a74b3f1c9d473c30b98';

test('operator UI and one-use replay probe use a real local OAuth session', {
	timeout: 90_000,
}, async () => {
	const output = resolve(authDirectory, 'node_modules/.cache', `afd-operator-test-${randomUUID()}`);
	await mkdir(output, { recursive: true });
	const controller = new AbortController();
	let local;
	let browser;
	try {
		await buildFixture(output);
		await build({
			entryPoints: [fileURLToPath(new URL('./local.ts', import.meta.url))],
			bundle: true,
			packages: 'external',
			platform: 'node',
			format: 'esm',
			target: 'node24',
			outfile: resolve(output, 'local.mjs'),
			logLevel: 'silent',
		});
		const { startLocal } = await import(resolve(output, 'local.mjs'));
		local = await startLocal(output, revision, 80_000, controller.signal);
		browser = await chromium.launch({ headless: true });
		const context = await browser.newContext({ ignoreHTTPSErrors: true });
		const first = await context.newPage();
		const second = await context.newPage();
		let origin = local.config.appURL;
		const post = (path, data, headers = {}) =>
			context.request.post(`${origin}${path}`, {
				data,
				headers: { origin, ...headers },
			});
		const signIn = async () => {
			await first.locator('#oauth').click();
			await first.locator('#allow').click();
			await first.locator('#session[data-status="authenticated"]').waitFor({ state: 'attached' });
		};
		await Promise.all([first.goto(origin), second.goto(origin)]);
		await first.locator('#session[data-status="unauthenticated"]').waitFor({ state: 'attached' });
		assert.equal((await post('/harness/probe/capture', '')).status(), 403);
		await signIn();
		await first.locator('#evidence').getByText('"expectedIdentityMatch":true').waitFor();
		const evidence = JSON.parse(await first.locator('#evidence').textContent());
		assert.equal(evidence.status, 'authenticated');
		assert.ok(evidence.sessionId && evidence.userId && evidence.expiresAt > Date.now());
		assert.equal(evidence.providerSessionMatches, true);
		assert.equal(evidence.providerUserMatches, true);
		assert.ok(evidence.providerExpiresAt >= evidence.expiresAt);
		assert.equal(evidence.expectedIdentityMatch, true);
		await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
		await first.locator('#refresh').click();
		await first.waitForFunction((initialExpiry) => {
			const raw = document.getElementById('evidence')?.textContent;
			if (!raw) return false;
			const renewed = JSON.parse(raw);
			return (
				renewed.expiresAt > initialExpiry &&
				renewed.providerExpiresAt >= renewed.expiresAt &&
				renewed.providerSessionMatches === true &&
				renewed.providerUserMatches === true &&
				renewed.expectedIdentityMatch === true
			);
		}, evidence.expiresAt);
		assert.ok(
			JSON.parse(await first.locator('#evidence').textContent()).providerExpiresAt >
				evidence.providerExpiresAt
		);
		await second.locator('#session[data-status="authenticated"]').waitFor({ state: 'attached' });
		assert.equal(
			JSON.parse(await second.locator('#evidence').textContent()).sessionId,
			evidence.sessionId
		);

		const active = await post('/harness/probe/capture', '');
		assert.equal(active.status(), 200);
		const sessionCookie = (await context.cookies()).find((cookie) =>
			cookie.name.endsWith('session_token')
		);
		assert.ok(sessionCookie);
		assert.ok(!(await active.text()).includes(sessionCookie.value));
		const { handle } = await active.json();
		assert.match(handle, /^[0-9a-f-]{36}$/);
		const accepted = await post('/harness/probe/verify', { handle });
		assert.deepEqual(await accepted.json(), { rejected: false, sameSession: true });
		assert.equal((await post('/harness/probe/verify', { handle })).status(), 404);
		assert.equal((await post('/harness/probe/verify', { handle: 'invalid' })).status(), 400);
		assert.equal((await post('/harness/probe/verify', { handle: randomUUID() })).status(), 404);
		assert.equal((await post('/harness/probe/capture', 'bad')).status(), 400);
		assert.equal((await post('/harness/probe/capture', 'x'.repeat(129))).status(), 403);
		assert.equal(
			(
				await post('/harness/probe/capture', '', { origin: 'https://untrusted.example.test' })
			).status(),
			403
		);
		assert.equal(
			(await context.request.post(`${origin}/harness/probe/capture`, { data: '' })).status(),
			403
		);
		const handles = [];
		for (let index = 0; index < 4; index++) {
			const response = await post('/harness/probe/capture', '');
			assert.equal(response.status(), 200);
			handles.push((await response.json()).handle);
		}
		assert.equal((await post('/harness/probe/capture', '')).status(), 400);
		for (const current of handles)
			assert.equal((await post('/harness/probe/verify', { handle: current })).status(), 200);
		const concurrent = await Promise.all(
			Array.from({ length: 16 }, () => post('/harness/probe/capture', ''))
		);
		assert.equal(concurrent.filter((response) => response.status() === 200).length, 4);
		assert.equal(concurrent.filter((response) => response.status() === 400).length, 12);
		for (const response of concurrent.filter((result) => result.status() === 200)) {
			const saved = await response.json();
			assert.equal((await post('/harness/probe/verify', { handle: saved.handle })).status(), 200);
		}

		await first.locator('#probe-capture').click();
		await first.locator('#probe-status').getByText('Captured one session').waitFor();
		assert.ok(!(await first.locator('body').textContent()).includes('session_token'));
		await first.locator('#sign-out').click();
		await first.locator('#session[data-status="unauthenticated"]').waitFor({ state: 'attached' });
		await second.locator('#session[data-status="unauthenticated"]').waitFor({ state: 'attached' });
		await first.locator('#probe-verify').click();
		await first.locator('#probe-status').getByText('Replay rejected: true').waitFor();
		assert.ok(!(await first.locator('body').textContent()).includes('session_token'));

		await signIn();
		await first.locator('#probe-capture').click();
		await first.locator('#probe-status').getByText('Captured one session').waitFor();
		await new Promise((resolveWait) => setTimeout(resolveWait, 13_000));
		await first.locator('#probe-verify').click();
		await first.locator('#probe-status').getByText('Replay rejected: true').waitFor();
		await first.locator('#refresh').click();
		await first.locator('#session[data-status="unauthenticated"]').waitFor({ state: 'attached' });
		await signIn();
		const protectedCapture = await post('/harness/probe/capture', '');
		assert.equal(protectedCapture.status(), 200);
		const protectedHandle = (await protectedCapture.json()).handle;
		assert.equal(
			(
				await context.request.post(`${origin}/harness/cleanup`, {
					headers: { authorization: 'Bearer invalid-control-key' },
				})
			).status(),
			403
		);
		assert.deepEqual(
			await (await post('/harness/probe/verify', { handle: protectedHandle })).json(),
			{
				rejected: false,
				sameSession: true,
			}
		);
		const cleanupCapture = await post('/harness/probe/capture', '');
		assert.equal(cleanupCapture.status(), 200);
		const cleanupHandle = (await cleanupCapture.json()).handle;
		const cleanup = await context.request.post(`${origin}/harness/cleanup`, {
			headers: { authorization: `Bearer ${local.config.controlKey}` },
		});
		assert.deepEqual(await cleanup.json(), { removed: true });
		assert.equal((await post('/harness/probe/verify', { handle: cleanupHandle })).status(), 404);
		assert.equal(await (await context.request.get(`${origin}/harness/session`)).json(), null);
		const emptyCleanup = await context.request.post(`${origin}/harness/cleanup`, {
			headers: { authorization: `Bearer ${local.config.controlKey}` },
		});
		assert.deepEqual(await emptyCleanup.json(), { removed: true });
		await first.locator('#refresh').click();
		await first.locator('#session[data-status="unauthenticated"]').waitFor({ state: 'attached' });
		await signIn();
		const racingCaptures = Array.from({ length: 16 }, () => post('/harness/probe/capture', ''));
		const racingCleanup = context.request.post(`${origin}/harness/cleanup`, {
			headers: { authorization: `Bearer ${local.config.controlKey}` },
		});
		const [raceResults, raceCleanupResult] = await Promise.all([
			Promise.all(racingCaptures),
			racingCleanup,
		]);
		assert.deepEqual(await raceCleanupResult.json(), { removed: true });
		for (const response of raceResults) {
			assert.ok([200, 400, 403].includes(response.status()));
			if (response.status() === 200) {
				const saved = await response.json();
				assert.equal((await post('/harness/probe/verify', { handle: saved.handle })).status(), 404);
			}
		}

		await local.close();
		local = await startLocal(output, revision, 80_000, controller.signal, 'different@example.test');
		origin = local.config.appURL;
		await first.goto(local.config.appURL);
		await signIn();
		await first.locator('#evidence').getByText('"expectedIdentityMatch":false').waitFor();
		assert.equal((await post('/harness/probe/capture', '')).status(), 403);
	} finally {
		controller.abort();
		await browser?.close();
		await local?.close();
		await rm(output, { recursive: true, force: true });
	}
});

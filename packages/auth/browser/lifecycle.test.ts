/** Chromium's cookie jar and real tabs; no fetch, provider, or adapter mocks. */
import { chromium, type Page, type Request } from 'playwright';
import { expect, it, onTestFinished } from 'vitest';
import type {} from './fixture.js';
import { startProvider } from './provider.js';

async function expectStatus(page: Page, status: string) {
	await expect.poll(() => page.locator('#session').getAttribute('data-status')).toBe(status);
}

for (const transport of ['BroadcastChannel', 'localStorage'] as const) {
	it(`renders the real cookie/session lifecycle across two tabs using ${transport}`, async () => {
		const provider = await startProvider({ expiresIn: 15, updateAge: 1 });
		onTestFinished(() => provider.close());
		const browser = await chromium.launch({ headless: true, timeout: 15_000 });
		onTestFinished(() => browser.close());
		const context = await browser.newContext();
		if (transport === 'localStorage') {
			// Exercise the supported feature fallback with real storage events.
			await context.addInitScript(() => {
				Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
			});
		}
		const first = await context.newPage();
		const second = await context.newPage();
		const errors: string[] = [];
		for (const page of [first, second]) page.on('pageerror', (error) => errors.push(error.message));
		await Promise.all([first.goto(provider.origin), second.goto(provider.origin)]);
		await expectStatus(first, 'unauthenticated');
		await expectStatus(second, 'unauthenticated');
		await first.evaluate(() => window.afdBrowser.register());
		await expectStatus(first, 'authenticated');
		await expectStatus(second, 'authenticated');
		expect(await second.locator('#session').textContent()).toBe('browser@example.test');
		expect(await second.evaluate(() => window.afdBrowser.messages())).toContainEqual({
			type: 'signed-in',
		});

		const cookie = (await context.cookies()).find((item) => item.name.endsWith('session_token'));
		expect(
			cookie && {
				httpOnly: cookie.httpOnly,
				sameSite: cookie.sameSite,
				secure: cookie.secure,
				path: cookie.path,
			}
		).toEqual({ httpOnly: true, sameSite: 'Lax', secure: false, path: '/' });
		expect(await first.evaluate(() => document.cookie.includes('session_token'))).toBe(false);
		// Reload restores the provider cookie into the actual AFD hooks.
		await second.reload();
		await expectStatus(second, 'authenticated');
		const restored = await second.evaluate(() => window.afdBrowser.snapshot());
		expect(restored).toMatchObject({
			status: 'authenticated',
			id: (await first.evaluate(() => window.afdBrowser.snapshot())).id,
		});
		const isolated = await browser.newContext();
		const stranger = await isolated.newPage();
		await stranger.goto(provider.origin);
		await expectStatus(stranger, 'unauthenticated');
		await isolated.close();

		// Distinct tabs really coordinate the refresh lock through localStorage.
		expect(await first.evaluate(() => window.afdBrowser.acquireLock())).toBe(true);
		expect(await second.evaluate(() => window.afdBrowser.acquireLock())).toBe(false);
		await second.evaluate(() => window.afdBrowser.releaseLock());
		expect(await second.evaluate(() => window.afdBrowser.acquireLock())).toBe(false);
		await first.evaluate(() => window.afdBrowser.releaseLock());
		expect(await second.evaluate(() => window.afdBrowser.acquireLock())).toBe(true);
		await second.evaluate(() => window.afdBrowser.releaseLock());

		await first.evaluate(() => window.afdBrowser.signOut());
		await expectStatus(first, 'unauthenticated');
		await expectStatus(second, 'unauthenticated');
		expect(await second.evaluate(() => window.afdBrowser.messages())).toContainEqual({
			type: 'signed-out',
		});
		expect(await first.evaluate(() => window.afdBrowser.signIn('incorrect'))).toBe(
			'INVALID_CREDENTIALS'
		);
		await expectStatus(first, 'unauthenticated');
		expect(await first.evaluate(() => window.afdBrowser.signIn())).toBe('signed-in');
		await expectStatus(first, 'authenticated');
		await expectStatus(second, 'authenticated');
		const signedIn = await first.evaluate(() => window.afdBrowser.snapshot());
		const oldCookies = (await context.cookies())
			.map(({ name, value }) => `${name}=${value}`)
			.join('; ');
		// Real wall-clock/provider renewal; neither Date nor provider storage is changed.
		await expect
			.poll(
				async () => {
					await first.evaluate(() => window.afdBrowser.refresh());
					return (await first.evaluate(() => window.afdBrowser.snapshot())).expiresAt ?? 0;
				},
				{ timeout: 6_000, interval: 350 }
			)
			.toBeGreaterThan(signedIn.expiresAt ?? Number.POSITIVE_INFINITY);
		// Each tab can legitimately renew the shared session again while refetching.
		// Compare identity and advancement from the baseline, not exact expiry equality.
		await expect
			.poll(() => second.evaluate(() => window.afdBrowser.snapshot()))
			.toMatchObject({ status: 'authenticated', id: signedIn.id });
		await expect
			.poll(async () => (await second.evaluate(() => window.afdBrowser.snapshot())).expiresAt ?? 0)
			.toBeGreaterThan(signedIn.expiresAt ?? Number.POSITIVE_INFINITY);
		const refreshedFirst = await first.evaluate(() => window.afdBrowser.snapshot());
		expect(refreshedFirst).toMatchObject({ status: 'authenticated', id: signedIn.id });
		expect(refreshedFirst.expiresAt ?? 0).toBeGreaterThan(
			signedIn.expiresAt ?? Number.POSITIVE_INFINITY
		);
		expect(await second.evaluate(() => window.afdBrowser.messages())).toContainEqual({
			type: 'session-refreshed',
		});
		const readback = await context.request.get(`${provider.origin}/api/auth/get-session`);
		const readbackData = (await readback.json()) as { session?: { id?: string } };
		expect(readbackData.session?.id).toBe(signedIn.id);

		await first.evaluate(() => window.afdBrowser.signOut());
		await expectStatus(first, 'unauthenticated');
		await expectStatus(second, 'unauthenticated');
		expect((await context.cookies()).some((item) => item.name.endsWith('session_token'))).toBe(
			false
		);
		// Independently replay the old synthetic session cookie after provider revocation.
		const revoked = await fetch(`${provider.origin}/api/auth/get-session`, {
			headers: { cookie: oldCookies },
			signal: AbortSignal.timeout(5_000),
		});
		expect((await revoked.json()) === null).toBe(true);
		expect(provider.database.session.length).toBe(0);
		expect(errors).toEqual([]);
		await context.close();
	});
}

it('drops a genuinely expired provider session after browser cookie expiry', async () => {
	const provider = await startProvider({ expiresIn: 3, updateAge: 60 });
	onTestFinished(() => provider.close());
	const browser = await chromium.launch({ headless: true, timeout: 15_000 });
	onTestFinished(() => browser.close());
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(provider.origin);
	await expectStatus(page, 'unauthenticated');
	await page.evaluate(() => window.afdBrowser.register());
	await expectStatus(page, 'authenticated');
	// Better Auth schedules its sign-up session signal after resolving registration.
	// Let those initial requests finish before observing cookie expiry in isolation.
	await page.waitForLoadState('networkidle');
	const oldCookies = (await context.cookies())
		.map(({ name, value }) => `${name}=${value}`)
		.join('; ');
	expect((await context.cookies()).some((item) => item.name.endsWith('session_token'))).toBe(true);
	// Observe Chromium expiry before asking the provider to refresh or delete anything.
	// The fixture disables polling/focus refetch; this sole tab receives no sync events.
	let providerRequests = 0;
	const countProviderRequest = (request: Request) => {
		if (new URL(request.url()).pathname.startsWith('/api/auth/')) providerRequests++;
	};
	page.on('request', countProviderRequest);
	await expect
		.poll(
			async () => (await context.cookies()).some((item) => item.name.endsWith('session_token')),
			{ timeout: 6_000, interval: 350 }
		)
		.toBe(false);
	page.off('request', countProviderRequest);
	expect(providerRequests).toBe(0);
	await page.evaluate(() => window.afdBrowser.refresh());
	await expectStatus(page, 'unauthenticated');
	expect(
		(await (await context.request.get(`${provider.origin}/api/auth/get-session`)).json()) === null
	).toBe(true);
	const expired = await fetch(`${provider.origin}/api/auth/get-session`, {
		headers: { cookie: oldCookies },
		signal: AbortSignal.timeout(5_000),
	});
	expect((await expired.json()) === null).toBe(true);
	expect(provider.database.session.length).toBe(0);
	await context.close();
});

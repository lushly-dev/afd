/** Actual browser/provider checks. Sensitive state is used only in memory, never in failures. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Browser, type BrowserContext, chromium, type Page, request } from 'playwright';
import { type Receipt, type RunConfig, receiptJSON } from './contract.js';
import type {} from './fixture.js';
import { startLocal } from './local.js';

async function poll(check: () => Promise<boolean>, timeout: number, signal: AbortSignal) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		signal.throwIfAborted();
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error('Assertion deadline');
}
export async function runHarness(input: {
	directory: string;
	config?: RunConfig;
	revision: string;
	deadlineMs: number;
	versions: Record<string, string>;
	signal: AbortSignal;
}) {
	let local: Awaited<ReturnType<typeof startLocal>> | undefined;
	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	let config = input.config;
	let phase = 'startup';
	let timer: ReturnType<typeof setTimeout> | undefined;
	const receipt: Receipt = {
		schema: 1,
		mode: config?.mode ?? 'local',
		provider: config ? 'configured-external-oidc' : 'test-only-local-oauth-pkce',
		origin: config?.appURL ?? 'https://127.0.0.1',
		revision: input.revision,
		node: process.versions.node,
		versions: input.versions,
		browser: 'not-started',
		assertions: [],
		result: 'failed',
		cleanup: 'not-started',
		resourceCleanup: 'not-run',
		checks: Object.fromEntries(
			[
				'startup',
				'fixture-identity',
				'oauth-denial',
				'oauth-recovery',
				'secure-cookie',
				'cleanup-authorization',
				'persistent-restart',
				'renewal',
				'revocation',
				'expiry-sign-in',
				'expiry',
			].map((name) => [name, 'not-run'])
		),
	};
	const waitFor = (check: () => Promise<boolean>, timeout: number) =>
		poll(check, timeout, input.signal);
	const stopBrowser = () => {
		void browser?.close();
	};
	input.signal.addEventListener('abort', stopBrowser, { once: true });
	const check = (valid: unknown) => {
		if (!valid) throw new Error('Assertion failed');
	};
	const pass = (name: string) => {
		receipt.assertions.push(name);
		receipt.checks[phase] = 'passed';
	};
	try {
		if (!config) {
			local = await startLocal(input.directory, input.revision, input.deadlineMs, input.signal);
			config = local.config;
		}
		input.signal.throwIfAborted();
		receipt.origin = config.appURL;
		receipt.revision = config.revision;
		browser = await chromium.launch({ headless: config.mode === 'local', timeout: 15_000 });
		input.signal.throwIfAborted();
		receipt.browser = browser.version();
		receipt.checks.startup = 'passed';
		// Deadline closes Chromium to interrupt navigation and pending UI operations.
		timer = setTimeout(() => {
			void browser?.close();
		}, config.deadlineMs);
		context = await browser.newContext({ ignoreHTTPSErrors: config.mode === 'local' });
		context.setDefaultTimeout(Math.min(15_000, config.deadlineMs));
		const first = await context.newPage();
		const second = await context.newPage();
		const cfg = config;
		const browserContext = context;
		let callbackCount = 0;
		first.on('request', (incoming) => {
			const url = new URL(incoming.url());
			if (url.origin === cfg.appURL && url.pathname === new URL(cfg.callbackURL).pathname)
				callbackCount++;
		});
		const status = async (page: Page, value: string) =>
			waitFor(
				async () => (await page.locator('#session').getAttribute('data-status')) === value,
				15_000
			);
		const api = await request.newContext({
			ignoreHTTPSErrors: cfg.mode === 'local',
			timeout: 5000,
		});
		try {
			const info = async () => {
				const response = await api.get(`${cfg.appURL}/harness/info`);
				check(response.ok());
				return (await response.json()) as {
					instanceId: string;
					revision: string;
					providerId: string;
					expiresIn: number;
					updateAge: number;
					providerKind: string;
					providerVersion: string;
				};
			};
			const initial = await info();
			phase = 'fixture-identity';
			check(/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(initial.providerVersion));
			receipt.versions.deployedBetterAuth = initial.providerVersion;
			check(initial.revision === cfg.revision && initial.providerId === cfg.providerId);
			check(
				initial.providerKind === receipt.provider &&
					initial.expiresIn >= 3 &&
					initial.expiresIn <= 60 &&
					initial.updateAge < initial.expiresIn
			);
			await Promise.all([first.goto(cfg.appURL), second.goto(cfg.appURL)]);
			await status(first, 'unauthenticated');
			await status(second, 'unauthenticated');
			pass('fresh Chromium and real AFD hooks signed out');
			process.send?.({ phase: 'fixture-ready' });
			async function oauth(decision: 'allow' | 'deny') {
				const beforeCallback = callbackCount;
				const outcome = await first.evaluate(() => window.afdHosted.oauth());
				check(outcome.kind === 'redirect' && outcome.before === 'unauthenticated' && outcome.url);
				const authorization = new URL(outcome.url ?? '');
				check(authorization.searchParams.get('redirect_uri') === cfg.callbackURL);
				await first.goto(authorization.href);
				if (cfg.mode === 'local') await first.locator(`#${decision}`).click();
				else
					process.stdout.write(
						`Complete ${decision === 'deny' ? 'DENIAL/CANCEL' : 'SUCCESSFUL sign-in'} in the opened disposable provider browser within the configured deadline.\n`
					);
				return beforeCallback;
			}
			phase = 'oauth-denial';
			const denialCallbacks = await oauth('deny');
			await first.waitForURL((url) => url.origin === cfg.appURL, { timeout: cfg.deadlineMs });
			check(callbackCount > denialCallbacks);
			// Better Auth may return its own error page; the app root then reads the provider again.
			await first.goto(cfg.returnURL);
			await status(first, 'unauthenticated');
			check((await (await context.request.get(`${cfg.appURL}/harness/session`)).json()) === null);
			pass('real OAuth callback denial leaves provider and hooks signed out');
			phase = 'oauth-recovery';
			const successCallbacks = await oauth('allow');
			await first.waitForURL(cfg.returnURL, { timeout: cfg.deadlineMs });
			check(callbackCount > successCallbacks);
			await status(first, 'authenticated');
			await first.evaluate(() => window.afdHosted.refresh());
			await status(second, 'authenticated');
			const signedIn = await first.evaluate(() => window.afdHosted.snapshot());
			check(signedIn.email === cfg.expectedEmail && signedIn.id && signedIn.userId);
			const readback = await (await context.request.get(`${cfg.appURL}/harness/session`)).json();
			check(
				readback.id === signedIn.id &&
					readback.userId === signedIn.userId &&
					readback.email === cfg.expectedEmail
			);
			pass('real OAuth callback recovery agrees with independent provider read and two-tab hooks');
			phase = 'cleanup-authorization';
			check(
				(
					await api.post(`${cfg.appURL}/harness/cleanup`, {
						headers: { authorization: 'Bearer invalid-test-key' },
					})
				).status() === 403
			);
			check(
				(await (await context.request.get(`${cfg.appURL}/harness/session`)).json()).id ===
					signedIn.id
			);
			pass('cleanup rejects incorrect control key without deleting the authenticated user');
			phase = 'secure-cookie';
			const cookie = (await context.cookies()).find((item) => item.name.endsWith('session_token'));
			check(cookie?.secure && cookie.httpOnly && cookie.path === '/' && cookie.sameSite === 'Lax');
			check(!(await first.evaluate(() => document.cookie.includes('session_token'))));
			const isolated = await browser.newContext({ ignoreHTTPSErrors: cfg.mode === 'local' });
			try {
				const stranger = await isolated.newPage();
				await stranger.goto(cfg.appURL);
				await status(stranger, 'unauthenticated');
			} finally {
				await isolated.close();
			}
			await second.reload();
			await status(second, 'authenticated');
			check((await second.evaluate(() => window.afdHosted.snapshot())).id === signedIn.id);
			pass('Secure HttpOnly SameSite=Lax root cookie, isolated context and reload');
			phase = 'persistent-restart';
			if (local) await local.restart();
			else {
				const [command, ...args] = cfg.restartCommand;
				if (!command) throw new Error('Missing restart command');
				await promisify(execFile)(command, args, {
					timeout: Math.min(30_000, cfg.deadlineMs),
					maxBuffer: 1024,
					signal: input.signal,
				});
			}
			await waitFor(async () => {
				try {
					return (await info()).instanceId !== initial.instanceId;
				} catch {
					return false;
				}
			}, 20_000);
			await second.reload();
			await status(second, 'authenticated');
			const restored = await second.evaluate(() => window.afdHosted.snapshot());
			const persisted = await (await context.request.get(`${cfg.appURL}/harness/session`)).json();
			check(
				restored.id === signedIn.id &&
					restored.userId === signedIn.userId &&
					persisted.id === signedIn.id &&
					persisted.userId === signedIn.userId
			);
			pass(
				'new server process and persistent SQLite restore SAME session and user with stable secret'
			);
			phase = 'renewal';
			await waitFor(
				async () => {
					await first.evaluate(() => window.afdHosted.refresh());
					return (
						((await first.evaluate(() => window.afdHosted.snapshot())).expiresAt ?? 0) >
						Math.max(signedIn.expiresAt ?? Number.POSITIVE_INFINITY, readback.expiresAt)
					);
				},
				(initial.updateAge + 5) * 1000
			);
			const renewed = await first.evaluate(() => window.afdHosted.snapshot());
			const renewalReadback = await (
				await api.get(`${cfg.appURL}/harness/session`, {
					headers: {
						cookie: (
							await context.cookies()
						)
							.map(({ name, value }) => `${name}=${value}`)
							.join('; '),
					},
				})
			).json();
			check(
				renewalReadback.id === signedIn.id &&
					renewalReadback.userId === signedIn.userId &&
					renewalReadback.expiresAt > readback.expiresAt &&
					renewalReadback.expiresAt >= (renewed.expiresAt ?? Number.POSITIVE_INFINITY)
			);
			pass(
				'actual application-session expiry advances and independent provider read confirms renewal'
			);
			const oldCookies = (await context.cookies())
				.map(({ name, value }) => `${name}=${value}`)
				.join('; ');
			phase = 'revocation';
			await first.evaluate(() => window.afdHosted.signOut());
			await status(first, 'unauthenticated');
			await status(second, 'unauthenticated');
			check(
				(await (
					await api.get(`${cfg.appURL}/harness/session`, { headers: { cookie: oldCookies } })
				).json()) === null
			);
			pass('sign-out reconciles two tabs and independent old-cookie replay is rejected');
			phase = 'expiry-sign-in';
			await oauth('allow');
			await first.waitForURL(cfg.returnURL, { timeout: cfg.deadlineMs });
			await status(first, 'authenticated');
			pass('subsequent OAuth sign-in recovers after revocation');
			await first.waitForLoadState('networkidle');
			await second.close(); // Remove sync-triggered refreshes during genuine idle expiry.
			const expiringCookies = (await context.cookies())
				.map(({ name, value }) => `${name}=${value}`)
				.join('; ');
			phase = 'expiry';
			await waitFor(
				async () =>
					!(await browserContext.cookies()).some((item) => item.name.endsWith('session_token')),
				(initial.expiresIn + 5) * 1000
			);
			await first.evaluate(() => window.afdHosted.refresh());
			await status(first, 'unauthenticated');
			check(
				(await (
					await api.get(`${cfg.appURL}/harness/session`, { headers: { cookie: expiringCookies } })
				).json()) === null
			);
			pass('idle real cookie/application-session expiry and independent rejection');
			receipt.result = cfg.mode === 'hosted' ? 'partial' : 'passed';
		} finally {
			await api.dispose();
		}
	} catch {
		receipt.failurePhase = phase;
		receipt.interrupted = input.signal.aborted;
		receipt.checks[phase] = 'failed';
	} finally {
		if (timer) clearTimeout(timer);
		input.signal.removeEventListener('abort', stopBrowser);
		try {
			if (config) {
				const cleanup = await request.newContext({
					ignoreHTTPSErrors: config.mode === 'local',
					timeout: config.mode === 'local' ? 1000 : 5000,
				});
				try {
					const response = await cleanup.post(`${config.appURL}/harness/cleanup`, {
						headers: { authorization: `Bearer ${config.controlKey}` },
					});
					check(response.ok() && (await response.json()).removed === true);
				} finally {
					await cleanup.dispose();
				}
			}
			await context?.close();
			await browser?.close();
			await local?.close();
			receipt.cleanup = config ? 'passed' : 'not-started';
			if (local) receipt.resourceCleanup = 'passed';
		} catch {
			receipt.cleanup = 'failed';
			receipt.result = 'failed';
			await browser?.close().catch(() => {});
			await local?.close().catch(() => {});
		}
	}
	process.stdout.write(`${receiptJSON(receipt)}\n`);
	if (receipt.result === 'failed') process.exitCode = 1;
	return receipt;
}

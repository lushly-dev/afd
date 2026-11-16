/** Actual browser/provider checks. Sensitive state is used only in memory, never in failures. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Browser, type BrowserContext, chromium, type Page, request } from 'playwright';
import {
	type CleanupStep,
	hasRestartLifetimeMargin,
	type Receipt,
	type RunConfig,
	receiptJSON,
	renewalEvidenceIsConsistent,
	reportedVersion,
	safeReason,
} from './contract.js';
import type {} from './fixture.js';
import { startLocal } from './local.js';
import { remainingBudgetMs, restartWithinBudget, withinTimeout } from './restart.js';

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
	interrupted?: () => boolean;
}) {
	let local: Awaited<ReturnType<typeof startLocal>> | undefined;
	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	let config = input.config;
	let phase = 'startup';
	const receipt: Receipt = {
		schema: 1,
		mode: config?.mode ?? 'local',
		provider: config ? 'configured-external-oidc' : 'test-only-local-oauth-pkce',
		origin: config?.appURL ?? 'https://127.0.0.1',
		revision: input.revision,
		node: process.versions.node,
		providerNode: 'not-observed',
		providerNodeAfterRestart: 'not-observed',
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
	// A label is fixed text or an adapter state name, never a value: it reaches stderr on failure.
	const check = (valid: unknown, label = '') => {
		if (!valid) throw new Error(label ? `Assertion failed: ${label}` : 'Assertion failed');
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
		browser = await chromium.launch({
			headless: config.mode === 'local',
			timeout: config.operationTimeoutMs,
		});
		input.signal.throwIfAborted();
		receipt.browser = browser.version();
		receipt.checks.startup = 'passed';
		context = await browser.newContext({ ignoreHTTPSErrors: config.mode === 'local' });
		context.setDefaultTimeout(config.operationTimeoutMs);
		context.setDefaultNavigationTimeout(config.operationTimeoutMs);
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
		const status = async (page: Page, value: string, timeoutMs = cfg.operationTimeoutMs) => {
			const startedAt = Date.now();
			return waitFor(async () => {
				try {
					return (
						(await page.locator('#session').getAttribute('data-status', {
							timeout: remainingBudgetMs(startedAt, timeoutMs),
						})) === value
					);
				} catch {
					return false;
				}
			}, timeoutMs);
		};
		const api = await request.newContext({
			ignoreHTTPSErrors: cfg.mode === 'local',
			timeout: cfg.operationTimeoutMs,
		});
		try {
			const info = async (timeout = cfg.operationTimeoutMs) => {
				const response = await api.get(`${cfg.appURL}/harness/info`, { timeout });
				check(response.ok());
				return (await response.json()) as {
					instanceId: string;
					revision: string;
					providerId: string;
					expiresIn: number;
					updateAge: number;
					providerKind: string;
					providerVersion: string;
					nodeVersion?: unknown;
				};
			};
			const sessionRead = async (timeout = cfg.operationTimeoutMs) => {
				const response = await browserContext.request.get(`${cfg.appURL}/harness/session`, {
					timeout,
				});
				check(response.ok());
				return response.json();
			};
			const initial = await info();
			phase = 'fixture-identity';
			check(/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(initial.providerVersion));
			receipt.versions.deployedBetterAuth = initial.providerVersion;
			// Recorded as the provider reported it; an absent value fails here rather than being guessed.
			receipt.providerNode = reportedVersion(initial.nodeVersion) ?? 'not-reported';
			check(receipt.providerNode !== 'not-reported');
			check(initial.revision === cfg.revision && initial.providerId === cfg.providerId);
			check(
				initial.providerKind === receipt.provider &&
					initial.expiresIn === cfg.sessionExpiresIn &&
					initial.updateAge === cfg.sessionUpdateAge &&
					initial.updateAge < initial.expiresIn
			);
			await Promise.all([first.goto(cfg.appURL), second.goto(cfg.appURL)]);
			await status(first, 'unauthenticated');
			await status(second, 'unauthenticated');
			pass('fresh Chromium and real AFD hooks signed out');
			process.send?.({ phase: 'fixture-ready' });
			async function oauth(decision: 'allow' | 'deny') {
				// The adapter itself must read signed out, and stay so for three consecutive reads: the DOM
				// attribute can lead it, and a sign-out sync can still be refetching in either tab.
				let signedOutReads = 0;
				await waitFor(async () => {
					try {
						const state = await first.evaluate(() => window.afdHosted.snapshot());
						signedOutReads = state.status === 'unauthenticated' ? signedOutReads + 1 : 0;
					} catch {
						signedOutReads = 0;
					}
					return signedOutReads >= 3;
				}, cfg.operationTimeoutMs);
				const beforeCallback = callbackCount;
				const outcome = await first.evaluate(() => window.afdHosted.oauth());
				check(outcome.kind === 'redirect' && outcome.url, `sign-in returned ${outcome.kind}`);
				check(
					outcome.before === 'unauthenticated',
					`adapter read ${outcome.before} when the redirect started`
				);
				const authorization = new URL(outcome.url ?? '');
				check(
					authorization.searchParams.get('redirect_uri') === cfg.callbackURL,
					'authorization redirect_uri is not the configured callback'
				);
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
			check((await sessionRead()) === null);
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
			const readback = await sessionRead();
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
			check((await sessionRead()).id === signedIn.id);
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
			phase = 'renewal';
			await waitFor(
				async () => {
					await first.evaluate(() => window.afdHosted.refresh());
					const renewed = await first.evaluate(() => window.afdHosted.snapshot());
					const renewalReadback = await sessionRead();
					return renewalEvidenceIsConsistent({
						originalAdapter: signedIn,
						originalProvider: readback,
						renewedAdapter: renewed,
						renewedProvider: renewalReadback,
					});
				},
				initial.updateAge * 1000 + Math.min(cfg.operationTimeoutMs, 5_000)
			);
			const preRestartSnapshot = await first.evaluate(() => window.afdHosted.snapshot());
			const preRestart = (await sessionRead()) as {
				id: string;
				userId: string;
				expiresAt: number;
			};
			check(
				renewalEvidenceIsConsistent({
					originalAdapter: signedIn,
					originalProvider: readback,
					renewedAdapter: preRestartSnapshot,
					renewedProvider: preRestart,
				}) &&
					hasRestartLifetimeMargin(
						preRestart.expiresAt,
						Date.now(),
						cfg.restartTimeoutMs,
						cfg.operationTimeoutMs
					)
			);
			pass('actual application session is renewed and read back with restart lifetime margin');
			phase = 'persistent-restart';
			let replacement: Awaited<ReturnType<typeof info>> | undefined;
			await restartWithinBudget({
				timeoutMs: cfg.restartTimeoutMs,
				restart: async (timeoutMs) => {
					if (local) await local.restart(timeoutMs);
					else {
						const [command, ...args] = cfg.restartCommand;
						if (!command) throw new Error('Missing restart command');
						await promisify(execFile)(command, args, {
							timeout: timeoutMs,
							maxBuffer: 1024,
							signal: input.signal,
						});
					}
				},
				observeRestart: (timeoutMs) => {
					const observationStartedAt = Date.now();
					return waitFor(async () => {
						try {
							const remainingMs = timeoutMs - (Date.now() - observationStartedAt);
							if (remainingMs <= 0) return false;
							const current = await info(
								Math.min(cfg.operationTimeoutMs, Math.max(1, remainingMs))
							);
							if (current.instanceId === initial.instanceId) return false;
							replacement = current;
							return true;
						} catch {
							return false;
						}
					}, timeoutMs);
				},
			});
			receipt.providerNodeAfterRestart =
				reportedVersion(replacement?.nodeVersion) ?? 'not-reported';
			check(receipt.providerNodeAfterRestart !== 'not-reported');
			const postRestartStartedAt = Date.now();
			const postRestartTimeout = () =>
				remainingBudgetMs(postRestartStartedAt, cfg.operationTimeoutMs);
			await second.reload({ timeout: postRestartTimeout() });
			await status(second, 'authenticated', postRestartTimeout());
			const restored = await withinTimeout(
				second.evaluate(() => window.afdHosted.snapshot()),
				postRestartTimeout()
			);
			const persisted = await sessionRead(postRestartTimeout());
			check(
				restored.id === preRestart.id &&
					restored.userId === preRestart.userId &&
					persisted.id === preRestart.id &&
					persisted.userId === preRestart.userId
			);
			pass(
				'new server process and persistent SQLite restore SAME session and user with stable secret'
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
	} catch (error) {
		// The receipt names the phase; stderr says why, one redacted line (#386 ejection diagnosis).
		process.stderr.write(`run failed at ${phase}: ${safeReason(error, config?.controlKey)}\n`);
		receipt.failurePhase = phase;
		receipt.interrupted = input.interrupted?.() ?? input.signal.aborted;
		receipt.checks[phase] = 'failed';
	} finally {
		input.signal.removeEventListener('abort', stopBrowser);
		let step: CleanupStep = 'cleanup-request';
		try {
			if (config) {
				const cleanup = await request.newContext({
					ignoreHTTPSErrors: config.mode === 'local',
					timeout: config.mode === 'local' ? 1000 : config.operationTimeoutMs,
				});
				try {
					const response = await cleanup.post(`${config.appURL}/harness/cleanup`, {
						headers: { authorization: `Bearer ${config.controlKey}` },
					});
					step = 'cleanup-response';
					if (!response.ok()) receipt.cleanupStatus = response.status();
					check(response.ok());
					step = 'cleanup-removed';
					check((await response.json()).removed === true);
				} finally {
					// A throw here replaces any earlier one, so it is this step's; otherwise the step stands.
					const before = step;
					step = 'cleanup-dispose';
					await cleanup.dispose();
					step = before;
				}
			}
			step = 'context-close';
			await context?.close();
			step = 'browser-close';
			await browser?.close();
			step = 'provider-close';
			await local?.close();
			receipt.cleanup = config ? 'passed' : 'not-started';
			if (local) receipt.resourceCleanup = 'passed';
		} catch (error) {
			// The receipt names the step; stderr says why, one line, with the control key never in it.
			receipt.cleanupFailure = step;
			process.stderr.write(`cleanup failed at ${step}: ${safeReason(error, config?.controlKey)}\n`);
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

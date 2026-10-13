import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { cleanupPage, closeWithStatus, runWithInterruption } from './browser-control.mjs';
import { buildFixture } from './build.mjs';
import {
	ConfigurationError,
	createReceipt,
	executeCleanup,
	loadConfig,
	safeFailureKind,
} from './lib.mjs';
import { cleanupIdentity, cleanupOAuthIdentity, runCredentials, runOAuth } from './scenarios.mjs';
import { startFixtureServer } from './server.mjs';

async function main() {
	let config;
	try {
		config = loadConfig(process.env, { explicit: process.argv.includes('--hosted') });
	} catch (error) {
		if (error instanceof ConfigurationError) {
			console.error(
				JSON.stringify({ status: 'not-run', requested: true, reason: 'configuration' })
			);
			process.exitCode = 2;
			return;
		}
		throw error;
	}
	if (!config.requested) {
		console.log(JSON.stringify(config));
		return;
	}

	const buildDir = await mkdtemp(join(tmpdir(), 'afd-convex-hosted-'));
	const assertions = [];
	const cleanupState = {
		contexts: [],
		primaryPage: null,
		secondaryPage: null,
		oauthPage: null,
		primaryContext: null,
		secondaryContext: null,
		oauthContext: null,
		primaryCreated: false,
		secondaryCreated: false,
		oauthAttempted: false,
		primaryCleaned: false,
		secondaryCleaned: false,
		oauthCleaned: false,
	};
	let server;
	let browser;
	let failure = null;
	let cleanup = [];
	try {
		await buildFixture(buildDir);
		// Bind the fixed OAuth return origin before Chromium can contact Convex.
		server = await startFixtureServer({
			directory: buildDir,
			deploymentUrl: config.deploymentUrl,
			origin: config.oauth?.returnUrl.origin,
		});
		browser = await chromium.launch({
			headless: config.oauth ? !config.oauth.headful : true,
			timeout: config.deadlineMs,
		});
		await runWithInterruption(
			async () => {
				await runCredentials(browser, server, config, assertions, cleanupState);
				await runOAuth(browser, server, config, assertions, cleanupState);
			},
			config.runDeadlineMs,
			async () => {
				const pages = [
					cleanupState.primaryPage,
					cleanupState.secondaryPage,
					cleanupState.oauthPage,
				].filter((page) => page && !page.isClosed());
				await Promise.all(
					pages.map((page, index) =>
						closeWithStatus(
							`interrupted-page-${index}`,
							() => page.close({ runBeforeUnload: false }),
							Math.min(config.deadlineMs, 5_000)
						)
					)
				);
			}
		);
	} catch (error) {
		failure = safeFailureKind(error);
		assertions.push({ name: 'hosted-runner-completion', status: 'failed', reason: failure });
	} finally {
		const cleaners = [];
		if (cleanupState.primaryCreated) {
			cleaners.push({
				name: 'primary-account',
				run: async () => {
					if (!cleanupState.primaryCleaned) {
						const page = await cleanupPage(
							cleanupState.primaryContext,
							cleanupState.primaryPage,
							server.origin,
							config.deadlineMs
						);
						await cleanupIdentity(page, config, config.primary);
					}
				},
			});
		}
		if (cleanupState.secondaryCreated) {
			cleaners.push({
				name: 'secondary-account',
				run: async () => {
					if (!cleanupState.secondaryCleaned) {
						const page = await cleanupPage(
							cleanupState.secondaryContext,
							cleanupState.secondaryPage,
							server.origin,
							config.deadlineMs
						);
						await cleanupIdentity(page, config, config.secondary);
					}
				},
			});
		}
		if (cleanupState.oauthAttempted) {
			cleaners.push({
				name: 'oauth-account',
				run: async () => {
					if (!cleanupState.oauthCleaned) {
						const page = await cleanupPage(
							cleanupState.oauthContext,
							cleanupState.oauthPage,
							server.origin,
							config.deadlineMs
						);
						await cleanupOAuthIdentity(page, config);
					}
				},
			});
		}
		cleanup = await executeCleanup(cleaners, config.deadlineMs);
		cleanup.push(
			await closeWithStatus(
				'browser-contexts',
				() => Promise.all(cleanupState.contexts.map((context) => context.close())),
				config.deadlineMs
			)
		);
		if (browser) {
			cleanup.push(await closeWithStatus('browser', () => browser.close(), config.deadlineMs));
		}
		if (server) {
			cleanup.push(
				await closeWithStatus('fixture-server', () => server.close(), config.deadlineMs)
			);
		}
		await rm(buildDir, { recursive: true, force: true });
	}

	// Account rows are removed and read back by this runner. Disposal of the
	// hosted deployment and any upstream OAuth grant happens after the runner,
	// so the machine receipt must remain partial until an operator records it.
	cleanup.push({ name: 'disposable-deployment', status: 'not-run' });
	if (config.oauth) cleanup.push({ name: 'oauth-provider-grant', status: 'not-run' });
	const receipt = createReceipt({
		runId: config.runId,
		revision: config.revision,
		deploymentUrl: config.deploymentUrl,
		assertions,
		cleanup,
		oauthConfigured: config.oauth !== null,
	});
	const receiptFile = config.receiptFile ?? join(tmpdir(), `afd-convex-hosted-${Date.now()}.json`);
	await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
	console.log(JSON.stringify({ status: receipt.status, receiptFile, failure }));
	if (failure || cleanup.some((item) => item.status === 'failed')) process.exitCode = 1;
}

await main();

import assert from 'node:assert/strict';
import { boundedEvaluate, openFreshPage, waitForStatus } from './browser-control.mjs';

const EXPECTED_CAPABILITIES = [
	'afd-adapter',
	'cleanup-readback-v1',
	'cleanup-v1',
	'principal-isolation',
	'protected-read',
];

function credentials(identity) {
	return { email: identity.email, password: identity.password, name: 'AFD hosted synthetic user' };
}

async function register(page, identity, timeout) {
	await boundedEvaluate(
		page,
		timeout,
		'register',
		(value) => window.afdConvex.register(value),
		credentials(identity)
	);
	await waitForStatus(page, 'authenticated', timeout);
}

async function verifyPreflight(page, config, expectedPrincipal, expectedEmail) {
	const expectedIdentity = {
		principalKind: expectedPrincipal,
		email: expectedEmail,
		...(expectedPrincipal === 'github-verified-primary'
			? { githubAccountId: config.oauth.githubAccountId }
			: {}),
	};
	const result = await boundedEvaluate(
		page,
		config.deadlineMs,
		'preflight',
		({ runId, expectedIdentity: identity }) => window.afdConvex.preflight(runId, identity),
		{ runId: config.runId, expectedIdentity }
	);
	assert.equal(result.enabled, true);
	assert.equal(result.revision, config.revision);
	assert.equal(result.identityMode, config.oauth?.identityMode ?? 'run-scoped');
	assert.equal(result.principalKind, expectedPrincipal);
	const expectedCapabilities = [...EXPECTED_CAPABILITIES];
	if (config.oauth?.identityMode === 'verified-github-account') {
		expectedCapabilities.push('github-verified-primary-identity-v1');
	}
	assert.deepEqual([...result.capabilities].sort(), expectedCapabilities.sort());
}

export async function cleanupIdentity(page, config, identity) {
	let snapshot = await boundedEvaluate(page, config.deadlineMs, 'cleanup-snapshot', () =>
		window.afdConvex.snapshot()
	);
	if (snapshot.status !== 'authenticated') {
		const outcome = await boundedEvaluate(
			page,
			config.deadlineMs,
			'cleanup-sign-in',
			(value) => window.afdConvex.signIn(value),
			credentials(identity)
		);
		if (outcome !== 'signed-in') throw new Error('cleanup-sign-in');
		await waitForStatus(page, 'authenticated', config.deadlineMs);
		snapshot = await boundedEvaluate(
			page,
			config.deadlineMs,
			'cleanup-authenticated-snapshot',
			() => window.afdConvex.snapshot()
		);
	}
	assert.equal(snapshot.email, identity.email);
	const summary = await boundedEvaluate(
		page,
		config.deadlineMs,
		'cleanup-delete-and-readback',
		({ runId, expectedEmail }) => window.afdConvex.cleanup(runId, expectedEmail),
		{ runId: config.runId, expectedEmail: identity.email }
	);
	assert.equal(summary.verified, true);
	assert.ok(summary.sessions > 0);
	assert.ok(summary.accounts > 0);
	await waitForStatus(page, 'unauthenticated', config.deadlineMs);
}

export async function cleanupOAuthIdentity(page, config) {
	const snapshot = await boundedEvaluate(page, config.deadlineMs, 'oauth-cleanup-snapshot', () =>
		window.afdConvex.snapshot()
	);
	if (snapshot.status !== 'authenticated') throw new Error('oauth-cleanup-auth-unavailable');
	assert.equal(snapshot.email, config.oauth.email);
	const summary = await boundedEvaluate(
		page,
		config.deadlineMs,
		'oauth-cleanup-delete-and-readback',
		({ runId, expectedEmail }) => window.afdConvex.cleanup(runId, expectedEmail),
		{ runId: config.runId, expectedEmail: config.oauth.email }
	);
	assert.equal(summary.verified, true);
	assert.ok(summary.sessions > 0);
	assert.ok(summary.accounts > 0);
	await waitForStatus(page, 'unauthenticated', config.deadlineMs);
}

export async function runCredentials(browser, server, config, assertions, cleanupState) {
	const primaryContext = await browser.newContext();
	const secondaryContext = await browser.newContext();
	cleanupState.contexts.push(primaryContext, secondaryContext);
	cleanupState.primaryContext = primaryContext;
	cleanupState.secondaryContext = secondaryContext;
	const primary = await openFreshPage(primaryContext, server.origin, config.deadlineMs);
	const secondary = await openFreshPage(secondaryContext, server.origin, config.deadlineMs);
	cleanupState.primaryPage = primary.page;
	cleanupState.secondaryPage = secondary.page;

	await waitForStatus(primary.page, 'unauthenticated', config.deadlineMs);
	const fresh = await boundedEvaluate(primary.page, config.deadlineMs, 'fresh-snapshot', () =>
		window.afdConvex.snapshot()
	);
	assert.ok(fresh.history.includes('loading'));
	assert.ok(fresh.history.includes('unauthenticated'));
	assert.equal(fresh.adapterStable, true);
	assert.equal(fresh.hasExpiresAt, false);
	assert.equal(secondary.pageErrors(), 0);
	assertions.push({ name: 'fresh-loading-to-unauthenticated', status: 'passed' });

	cleanupState.primaryCreated = true;
	await register(primary.page, config.primary, config.deadlineMs);
	await verifyPreflight(primary.page, config, 'password', config.primary.email);
	assertions.push({ name: 'password-primary-preflight', status: 'passed' });
	let primarySnapshot = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'primary-snapshot',
		() => window.afdConvex.snapshot()
	);
	assert.equal(primarySnapshot.email, config.primary.email);
	assert.equal(primarySnapshot.sessionId, `convex-${primarySnapshot.userId}`);
	assert.equal(primarySnapshot.hasExpiresAt, false);
	assertions.push({ name: 'credentials-and-identity-mapping', status: 'passed' });

	await boundedEvaluate(primary.page, config.deadlineMs, 'credential-sign-out', () =>
		window.afdConvex.signOut()
	);
	await waitForStatus(primary.page, 'unauthenticated', config.deadlineMs);
	const invalid = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'invalid-credential-sign-in',
		(value) => window.afdConvex.signIn(value),
		{ email: config.primary.email, password: `${config.primary.password}-invalid` }
	);
	assert.ok(['INVALID_CREDENTIALS', 'PROVIDER_ERROR'].includes(invalid));
	const signedIn = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'credential-sign-in',
		(value) => window.afdConvex.signIn(value),
		credentials(config.primary)
	);
	assert.equal(signedIn, 'signed-in');
	await waitForStatus(primary.page, 'authenticated', config.deadlineMs);
	assertions.push({ name: 'invalid-credentials-and-sign-in-outcomes', status: 'passed' });

	primarySnapshot = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'pre-profile-snapshot',
		() => window.afdConvex.snapshot()
	);
	const notificationCount = primarySnapshot.notifications.length;
	await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'update-profile',
		({ runId, name }) => window.afdConvex.updateProfile(runId, name),
		{ runId: config.runId, name: 'AFD hosted profile updated' }
	);
	await primary.page.waitForFunction(
		(previousCount) => {
			const snapshot = window.afdConvex.snapshot();
			return (
				snapshot.name === 'AFD hosted profile updated' &&
				snapshot.notifications.length > previousCount &&
				snapshot.notifications.some(
					(notification) =>
						notification.status === 'authenticated' &&
						notification.name === 'AFD hosted profile updated'
				)
			);
		},
		notificationCount,
		{ timeout: config.deadlineMs }
	);
	const updated = await boundedEvaluate(primary.page, config.deadlineMs, 'updated-snapshot', () =>
		window.afdConvex.snapshot()
	);
	assert.ok(
		updated.notifications.some(
			(notification) =>
				notification.status === 'authenticated' &&
				notification.name === 'AFD hosted profile updated'
		)
	);
	assert.equal(updated.adapterStable, true);
	assertions.push({ name: 'stable-snapshot-and-profile-notification', status: 'passed' });

	const recordId = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'create-record',
		({ runId, value }) => window.afdConvex.createRecord(runId, value),
		{ runId: config.runId, value: 'primary-only' }
	);
	const sessionBeforeReload = updated.sessionId;
	await primary.page.reload({ waitUntil: 'domcontentloaded', timeout: config.deadlineMs });
	await primary.page.waitForFunction(() => window.afdConvex !== undefined, undefined, {
		timeout: config.deadlineMs,
	});
	await waitForStatus(primary.page, 'authenticated', config.deadlineMs);
	primarySnapshot = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'post-reload-snapshot',
		() => window.afdConvex.snapshot()
	);
	assert.equal(primarySnapshot.sessionId, sessionBeforeReload);
	await primaryContext.setOffline(true);
	await primary.page.waitForFunction(
		() => window.afdConvex.snapshot().connected === false,
		undefined,
		{
			timeout: config.deadlineMs,
		}
	);
	await primaryContext.setOffline(false);
	await primary.page.waitForFunction(
		() => window.afdConvex.snapshot().connected === true,
		undefined,
		{
			timeout: config.deadlineMs,
		}
	);
	const afterReconnect = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'post-reconnect-protected-read',
		({ runId, recordId }) => window.afdConvex.protectedRead(runId, recordId),
		{ runId: config.runId, recordId }
	);
	assert.deepEqual(afterReconnect, { ok: true, value: 'primary-only' });
	assertions.push({ name: 'reload-and-reconnect-continuity', status: 'passed' });

	cleanupState.secondaryCreated = true;
	await register(secondary.page, config.secondary, config.deadlineMs);
	await verifyPreflight(secondary.page, config, 'password', config.secondary.email);
	assertions.push({ name: 'password-secondary-preflight', status: 'passed' });
	const crossPrincipal = await boundedEvaluate(
		secondary.page,
		config.deadlineMs,
		'cross-principal-protected-read',
		({ runId, recordId }) => window.afdConvex.protectedRead(runId, recordId),
		{ runId: config.runId, recordId }
	);
	assert.deepEqual(crossPrincipal, { ok: false, reason: 'FORBIDDEN' });
	assertions.push({ name: 'two-principal-separation', status: 'passed' });

	await boundedEvaluate(primary.page, config.deadlineMs, 'protected-read-sign-out', () =>
		window.afdConvex.signOut()
	);
	await waitForStatus(primary.page, 'unauthenticated', config.deadlineMs);
	const denied = await boundedEvaluate(
		primary.page,
		config.deadlineMs,
		'signed-out-protected-read',
		({ runId, recordId }) => window.afdConvex.protectedRead(runId, recordId),
		{ runId: config.runId, recordId }
	);
	assert.deepEqual(denied, { ok: false, reason: 'UNAUTHENTICATED' });
	assertions.push({ name: 'protected-query-denied-after-signout', status: 'passed' });

	await cleanupIdentity(secondary.page, config, config.secondary);
	cleanupState.secondaryCleaned = true;
	await cleanupIdentity(primary.page, config, config.primary);
	cleanupState.primaryCleaned = true;
	assert.equal(primary.pageErrors(), 0);
}

export async function runOAuth(browser, server, config, assertions, cleanupState) {
	if (!config.oauth) {
		assertions.push({ name: 'oauth-initiation-and-callback', status: 'not-run' });
		return;
	}
	const context = await browser.newContext(
		config.oauth.storageState ? { storageState: config.oauth.storageState } : undefined
	);
	cleanupState.contexts.push(context);
	cleanupState.oauthContext = context;
	const { page, pageErrors } = await openFreshPage(context, server.origin, config.deadlineMs);
	cleanupState.oauthPage = page;
	await waitForStatus(page, 'unauthenticated', config.deadlineMs);
	const scopes = await boundedEvaluate(
		page,
		config.deadlineMs,
		'oauth-scopes-rejection',
		(provider) => window.afdConvex.checkScopesRejected(provider),
		config.oauth.providerId
	);
	assert.equal(scopes, 'PROVIDER_ERROR');

	cleanupState.oauthAttempted = true;
	void boundedEvaluate(
		page,
		config.oauthDeadlineMs,
		'oauth-initiation',
		({ provider, redirectTo }) => window.afdConvex.startOAuth(provider, redirectTo),
		{
			provider: config.oauth.providerId,
			redirectTo: config.oauth.returnUrl.href,
		}
	).catch(() => undefined);
	await page.waitForURL((url) => url.origin !== server.origin, { timeout: config.deadlineMs });
	if (config.oauth.headful) {
		console.log('Complete OAuth login using the configured GitHub test identity.');
	}
	await page.waitForURL((url) => url.origin === config.oauth.returnUrl.origin, {
		timeout: config.oauthDeadlineMs,
	});
	await page.waitForFunction(() => window.afdConvex !== undefined, undefined, {
		timeout: config.deadlineMs,
	});
	await waitForStatus(page, 'authenticated', config.deadlineMs);
	await verifyPreflight(
		page,
		config,
		config.oauth.identityMode === 'verified-github-account'
			? 'github-verified-primary'
			: 'github-run-scoped',
		config.oauth.email
	);
	assertions.push({
		name:
			config.oauth.identityMode === 'verified-github-account'
				? 'oauth-verified-primary-preflight'
				: 'oauth-run-scoped-preflight',
		status: 'passed',
	});
	const snapshot = await boundedEvaluate(page, config.deadlineMs, 'oauth-snapshot', () =>
		window.afdConvex.snapshot()
	);
	assert.equal(snapshot.email, config.oauth.email);
	assert.equal(snapshot.hasExpiresAt, false);
	assert.equal(
		await boundedEvaluate(page, config.deadlineMs, 'oauth-outcome', () =>
			window.afdConvex.oauthOutcome()
		),
		'redirect'
	);
	assert.equal(pageErrors(), 0);
	assertions.push({ name: 'oauth-initiation-and-callback', status: 'passed' });

	const summary = await boundedEvaluate(
		page,
		config.deadlineMs,
		'oauth-cleanup-delete-and-readback',
		({ runId, expectedEmail }) => window.afdConvex.cleanup(runId, expectedEmail),
		{ runId: config.runId, expectedEmail: config.oauth.email }
	);
	assert.equal(summary.verified, true);
	assert.ok(summary.sessions > 0);
	assert.ok(summary.accounts > 0);
	await waitForStatus(page, 'unauthenticated', config.deadlineMs);
	cleanupState.oauthCleaned = true;
}

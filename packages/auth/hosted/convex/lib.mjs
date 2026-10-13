import { randomUUID } from 'node:crypto';

export class ConfigurationError extends Error {
	constructor(missing) {
		super(`Hosted Convex auth configuration is incomplete: ${missing.join(', ')}`);
		this.name = 'ConfigurationError';
		this.missing = missing;
	}
}

const REQUIRED = [
	'AFD_AUTH_HOSTED_CONVEX_URL',
	'AFD_AUTH_HOSTED_CONVEX_SITE_URL',
	'AFD_AUTH_HOSTED_REVISION',
	'AFD_AUTH_HOSTED_RUN_ID',
	'AFD_AUTH_HOSTED_EMAIL_SUFFIX',
	'AFD_AUTH_HOSTED_PRIMARY_EMAIL',
	'AFD_AUTH_HOSTED_PRIMARY_PASSWORD',
	'AFD_AUTH_HOSTED_SECONDARY_EMAIL',
	'AFD_AUTH_HOSTED_SECONDARY_PASSWORD',
];

function httpsUrl(value, name) {
	const url = parseUrl(value, name);
	if (url.protocol !== 'https:') throw new ConfigurationError([`${name} must use HTTPS`]);
	if (url.username || url.password) {
		throw new ConfigurationError([`${name} must not contain credentials`]);
	}
	if (url.search || url.hash) {
		throw new ConfigurationError([`${name} must not contain a query or fragment`]);
	}
	return url;
}

function parseUrl(value, name, base) {
	try {
		return new URL(value, base);
	} catch {
		throw new ConfigurationError([`${name} is invalid`]);
	}
}

function positiveInteger(value, fallback, name) {
	if (value === undefined) return fallback;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) {
		throw new ConfigurationError([`${name} must be a positive integer`]);
	}
	return number;
}

function canonicalConvexDeploymentName(url, suffix, name) {
	if (url.port !== '' || url.pathname !== '/') {
		throw new ConfigurationError([`${name} must be a canonical Convex origin`]);
	}
	const hostnameSuffix = `.convex.${suffix}`;
	if (!url.hostname.endsWith(hostnameSuffix)) {
		throw new ConfigurationError([`${name} must use a Convex .${suffix} hostname`]);
	}
	const deploymentName = url.hostname.slice(0, -hostnameSuffix.length);
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(deploymentName)) {
		throw new ConfigurationError([`${name} must use a canonical Convex deployment hostname`]);
	}
	return deploymentName;
}

function requireFixedLoopbackPort(url) {
	const port = Number(url.port);
	if (!url.port || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		throw new ConfigurationError([
			'AFD_AUTH_HOSTED_RETURN_URL must include a fixed nonzero loopback port',
		]);
	}
}

export function loadConfig(env = process.env, { explicit = false } = {}) {
	if (env.AFD_AUTH_HOSTED_ADAPTER === undefined) {
		if (explicit) throw new ConfigurationError(['AFD_AUTH_HOSTED_ADAPTER']);
		return { requested: false, status: 'not-run', reason: 'adapter-not-requested' };
	}
	if (env.AFD_AUTH_HOSTED_ADAPTER !== 'convex') {
		throw new ConfigurationError(['AFD_AUTH_HOSTED_ADAPTER must equal convex']);
	}
	const missing = REQUIRED.filter((name) => !env[name]);
	if (missing.length > 0) throw new ConfigurationError(missing);

	const runId = env.AFD_AUTH_HOSTED_RUN_ID;
	if (!/^[a-z0-9-]{8,64}$/i.test(runId)) {
		throw new ConfigurationError(['AFD_AUTH_HOSTED_RUN_ID has invalid format']);
	}
	const suffix = env.AFD_AUTH_HOSTED_EMAIL_SUFFIX.toLowerCase();
	const primaryEmail = env.AFD_AUTH_HOSTED_PRIMARY_EMAIL.toLowerCase();
	const secondaryEmail = env.AFD_AUTH_HOSTED_SECONDARY_EMAIL.toLowerCase();
	for (const [name, email] of [
		['AFD_AUTH_HOSTED_PRIMARY_EMAIL', primaryEmail],
		['AFD_AUTH_HOSTED_SECONDARY_EMAIL', secondaryEmail],
	]) {
		if (!email.endsWith(suffix) || !email.includes(runId.toLowerCase())) {
			throw new ConfigurationError([`${name} is outside the run ID and email suffix scope`]);
		}
	}
	if (primaryEmail === secondaryEmail) {
		throw new ConfigurationError(['synthetic principal emails must differ']);
	}

	const deploymentUrl = httpsUrl(env.AFD_AUTH_HOSTED_CONVEX_URL, 'deployment URL');
	const siteUrl = httpsUrl(env.AFD_AUTH_HOSTED_CONVEX_SITE_URL, 'site URL');
	const cloudDeploymentName = canonicalConvexDeploymentName(
		deploymentUrl,
		'cloud',
		'deployment URL'
	);
	const siteDeploymentName = canonicalConvexDeploymentName(siteUrl, 'site', 'site URL');
	if (cloudDeploymentName !== siteDeploymentName) {
		throw new ConfigurationError([
			'deployment URL and site URL must identify the same Convex deployment',
		]);
	}
	const providerId = env.AFD_AUTH_HOSTED_PROVIDER_ID;
	let oauth = null;
	if (providerId !== undefined) {
		const oauthRequired = [
			'AFD_AUTH_HOSTED_PROVIDER_CALLBACK_URL',
			'AFD_AUTH_HOSTED_RETURN_URL',
			'AFD_AUTH_HOSTED_OAUTH_EMAIL',
		];
		const oauthMissing = oauthRequired.filter((name) => !env[name]);
		if (oauthMissing.length > 0) throw new ConfigurationError(oauthMissing);
		if (providerId !== 'github') {
			throw new ConfigurationError(['this fixture supports the installed GitHub OAuth provider']);
		}
		const callbackUrl = httpsUrl(
			env.AFD_AUTH_HOSTED_PROVIDER_CALLBACK_URL,
			'provider callback URL'
		);
		const expectedCallback = parseUrl(
			`/api/auth/callback/${providerId}`,
			'expected provider callback URL',
			siteUrl
		);
		if (callbackUrl.href !== expectedCallback.href) {
			throw new ConfigurationError([
				'provider callback URL does not match the Convex site callback',
			]);
		}
		const returnUrl = parseUrl(env.AFD_AUTH_HOSTED_RETURN_URL, 'OAuth return URL');
		requireFixedLoopbackPort(returnUrl);
		if (
			returnUrl.protocol !== 'http:' ||
			!['127.0.0.1', 'localhost'].includes(returnUrl.hostname) ||
			returnUrl.username ||
			returnUrl.password ||
			returnUrl.pathname !== '/' ||
			returnUrl.search ||
			returnUrl.hash
		) {
			throw new ConfigurationError(['OAuth return URL must be an HTTP loopback URL']);
		}
		const email = env.AFD_AUTH_HOSTED_OAUTH_EMAIL.toLowerCase();
		if (!email.endsWith(suffix) || !email.includes(runId.toLowerCase())) {
			throw new ConfigurationError(['OAuth identity email is outside the run scope']);
		}
		if (email === primaryEmail || email === secondaryEmail) {
			throw new ConfigurationError([
				'OAuth identity must differ from both synthetic Password identities',
			]);
		}
		oauth = {
			providerId,
			callbackUrl,
			returnUrl,
			email,
			storageState: env.AFD_AUTH_HOSTED_OAUTH_STORAGE_STATE,
			headful: env.AFD_AUTH_HOSTED_OAUTH_HEADFUL === 'true',
		};
		if (!oauth.headful && !oauth.storageState) {
			throw new ConfigurationError([
				'OAuth requires headful test-identity login or a protected storage-state path',
			]);
		}
	}

	return {
		requested: true,
		deploymentUrl,
		siteUrl,
		revision: env.AFD_AUTH_HOSTED_REVISION,
		runId,
		emailSuffix: suffix,
		primary: { email: primaryEmail, password: env.AFD_AUTH_HOSTED_PRIMARY_PASSWORD },
		secondary: { email: secondaryEmail, password: env.AFD_AUTH_HOSTED_SECONDARY_PASSWORD },
		oauth,
		deadlineMs: positiveInteger(env.AFD_AUTH_HOSTED_DEADLINE_MS, 60_000, 'deadline'),
		oauthDeadlineMs: positiveInteger(
			env.AFD_AUTH_HOSTED_OAUTH_DEADLINE_MS,
			180_000,
			'OAuth deadline'
		),
		runDeadlineMs: positiveInteger(
			env.AFD_AUTH_HOSTED_RUN_DEADLINE_MS,
			oauth === null ? 180_000 : 360_000,
			'hosted run deadline'
		),
		receiptFile: env.AFD_AUTH_HOSTED_RECEIPT_FILE,
	};
}

export async function withDeadline(operation, timeoutMs, label) {
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(Object.assign(new Error(label), { code: 'DEADLINE' })),
			timeoutMs
		);
	});
	try {
		return await Promise.race([Promise.resolve().then(operation), deadline]);
	} finally {
		clearTimeout(timer);
	}
}

export async function executeCleanup(cleaners, timeoutMs) {
	const results = [];
	for (const cleaner of cleaners) {
		try {
			await withDeadline(cleaner.run, timeoutMs, `${cleaner.name}-cleanup`);
			results.push({ name: cleaner.name, status: 'passed' });
		} catch {
			results.push({ name: cleaner.name, status: 'failed' });
		}
	}
	return results;
}

export function createReceipt({
	runId,
	revision,
	deploymentUrl,
	assertions,
	cleanup,
	oauthConfigured,
}) {
	const requiredPassed = assertions.every((assertion) => assertion.status === 'passed');
	const cleanupPassed = cleanup.every((item) => item.status === 'passed');
	return {
		schemaVersion: 1,
		receiptId: randomUUID(),
		runId,
		kind: 'afd-convex-hosted-auth',
		status: requiredPassed && cleanupPassed && oauthConfigured ? 'passed' : 'partial',
		revision,
		deploymentOrigin: deploymentUrl.origin,
		provider: { convex: '1.32.0', convexAuth: '0.0.95', oauthConfigured },
		assertions,
		cleanup,
		limits: [
			'No provider token or expiry is exposed by the AFD adapter.',
			'This receipt does not establish upstream OAuth token rotation.',
			'The synthetic adapter session identifier is not a bearer token.',
		],
	};
}

export function safeFailureKind(error) {
	if (error?.code === 'DEADLINE') return 'deadline';
	if (error?.code === 'INTERRUPTED') return 'interrupted';
	if (error?.code === 'FIXTURE_LOOPBACK_PORT_IN_USE') return 'loopback-port-in-use';
	if (error?.code === 'FIXTURE_LOOPBACK_PORT_BIND_FAILED') return 'loopback-port-bind-failed';
	if (error instanceof ConfigurationError) return 'configuration';
	if (error?.name === 'AssertionError') return 'assertion';
	return 'hosted-runner';
}

/** Opt-in contract. Never turn missing hosted configuration into a skipped pass. */
export interface RunConfig {
	mode: 'local' | 'hosted';
	appURL: string;
	providerId: string;
	callbackURL: string;
	returnURL: string;
	expectedEmail: string;
	revision: string;
	controlKey: string;
	restartCommand: string[];
	deadlineMs: number;
	operationTimeoutMs: number;
	restartTimeoutMs: number;
	sessionExpiresIn: number;
	sessionUpdateAge: number;
}

interface SessionEvidence {
	id?: string;
	userId?: string;
	expiresAt?: number;
}

export const RESTART_CLOCK_SKEW_MARGIN_MS = 1_000;

function finiteTimestamp(value: number | undefined): value is number {
	return Number.isFinite(value);
}

export function renewalEvidenceIsConsistent(input: {
	originalAdapter: SessionEvidence;
	originalProvider: SessionEvidence;
	renewedAdapter: SessionEvidence;
	renewedProvider: SessionEvidence;
}): boolean {
	const { originalAdapter, originalProvider, renewedAdapter, renewedProvider } = input;
	if (!originalAdapter.id || !originalAdapter.userId) return false;
	if (
		![originalProvider, renewedAdapter, renewedProvider].every(
			(item) => item.id === originalAdapter.id && item.userId === originalAdapter.userId
		)
	)
		return false;
	if (
		!finiteTimestamp(originalAdapter.expiresAt) ||
		!finiteTimestamp(originalProvider.expiresAt) ||
		!finiteTimestamp(renewedAdapter.expiresAt) ||
		!finiteTimestamp(renewedProvider.expiresAt)
	)
		return false;
	return (
		renewedAdapter.expiresAt > Math.max(originalAdapter.expiresAt, originalProvider.expiresAt) &&
		renewedProvider.expiresAt >= renewedAdapter.expiresAt
	);
}

export function requiredRestartLifetimeMs(restartTimeoutMs: number, operationTimeoutMs: number) {
	return restartTimeoutMs + operationTimeoutMs + RESTART_CLOCK_SKEW_MARGIN_MS;
}

export function hasRestartLifetimeMargin(
	expiresAt: number | undefined,
	now: number,
	restartTimeoutMs: number,
	operationTimeoutMs: number
): boolean {
	return (
		finiteTimestamp(expiresAt) &&
		expiresAt - now > requiredRestartLifetimeMs(restartTimeoutMs, operationTimeoutMs)
	);
}

function boundedInteger(
	name: string,
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
	}
	return parsed;
}

export function deadline(value: string | undefined, fallback = 180_000): number {
	const ms = Number(value ?? fallback);
	if (!Number.isInteger(ms) || ms < 10_000 || ms > 900_000) {
		throw new Error('AFD_BA_DEADLINE_MS must be an integer between 10000 and 900000');
	}
	return ms;
}

export function hostedListenConfig(env: NodeJS.ProcessEnv): { host: string; port: number } {
	const host = env.AFD_BA_HOST?.trim() || '127.0.0.1';
	if (!['127.0.0.1', '0.0.0.0'].includes(host)) {
		throw new Error('AFD_BA_HOST must be 127.0.0.1 or 0.0.0.0');
	}
	const portValue = env.AFD_BA_PORT ?? env.PORT ?? '3000';
	if (!/^\d+$/.test(portValue)) throw new Error('AFD_BA_PORT or PORT must be a decimal port');
	const port = Number(portValue);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error('AFD_BA_PORT or PORT must be between 1 and 65535');
	}
	return { host, port };
}

export function hostedConfig(env: NodeJS.ProcessEnv): RunConfig {
	if (env.AFD_BA_DISPOSABLE !== '1')
		throw new Error('AFD_BA_DISPOSABLE=1 is required for a dedicated test deployment');
	const required = [
		'APP_URL',
		'PROVIDER_ID',
		'CALLBACK_URL',
		'RETURN_URL',
		'EXPECTED_EMAIL',
		'REVISION',
		'CONTROL_KEY',
		'RESTART_COMMAND',
	];
	for (const name of required) {
		if (!env[`AFD_BA_${name}`]?.trim()) throw new Error(`Missing AFD_BA_${name}`);
	}
	if (!/^[a-f0-9]{7,64}$/i.test(env.AFD_BA_REVISION ?? ''))
		throw new Error('Revision must be a source commit identifier');
	const app = new URL(env.AFD_BA_APP_URL ?? '');
	const callback = new URL(env.AFD_BA_CALLBACK_URL ?? '');
	const destination = new URL(env.AFD_BA_RETURN_URL ?? '');
	for (const url of [app, callback, destination]) {
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
			throw new Error('Hosted URLs must be HTTPS without credentials, queries or fragments');
		}
		if (url.origin !== app.origin) throw new Error('This fixture requires same-origin topology');
	}
	if (app.pathname !== '/' || destination.pathname !== '/')
		throw new Error('App and return URL must be the fixture root');
	const providerId = env.AFD_BA_PROVIDER_ID ?? '';
	if (!/^[a-z][a-z0-9-]{0,63}$/.test(providerId)) throw new Error('Invalid AFD_BA_PROVIDER_ID');
	if (callback.pathname !== `/api/auth/callback/${providerId}`)
		throw new Error('Callback does not match Better Auth callback path');
	let restartCommand: unknown;
	try {
		restartCommand = JSON.parse(env.AFD_BA_RESTART_COMMAND ?? '');
	} catch {
		throw new Error('Restart command must be a JSON argv array');
	}
	if (
		!Array.isArray(restartCommand) ||
		!restartCommand.length ||
		!restartCommand.every((part) => typeof part === 'string' && part.length > 0)
	) {
		throw new Error('Restart command must be a nonempty JSON argv array');
	}
	if ((env.AFD_BA_CONTROL_KEY?.length ?? 0) < 32)
		throw new Error('Control key must contain at least 32 characters');
	const sessionExpiresIn = boundedInteger(
		'AFD_BA_SESSION_EXPIRES_IN',
		env.AFD_BA_SESSION_EXPIRES_IN,
		180,
		120,
		300
	);
	const sessionUpdateAge = boundedInteger(
		'AFD_BA_SESSION_UPDATE_AGE',
		env.AFD_BA_SESSION_UPDATE_AGE,
		5,
		1,
		30
	);
	if (sessionUpdateAge >= sessionExpiresIn)
		throw new Error('AFD_BA_SESSION_UPDATE_AGE must be less than AFD_BA_SESSION_EXPIRES_IN');
	const operationTimeoutMs = boundedInteger(
		'AFD_BA_OPERATION_TIMEOUT_MS',
		env.AFD_BA_OPERATION_TIMEOUT_MS,
		15_000,
		5_000,
		60_000
	);
	const restartTimeoutMs = boundedInteger(
		'AFD_BA_RESTART_TIMEOUT_MS',
		env.AFD_BA_RESTART_TIMEOUT_MS,
		90_000,
		30_000,
		120_000
	);
	if (sessionExpiresIn * 1000 <= requiredRestartLifetimeMs(restartTimeoutMs, operationTimeoutMs)) {
		throw new Error(
			'AFD_BA_SESSION_EXPIRES_IN must exceed restart, post-restart operation and clock-skew budgets'
		);
	}
	const deadlineMs = deadline(env.AFD_BA_DEADLINE_MS, 600_000);
	if (deadlineMs <= sessionExpiresIn * 1000 + restartTimeoutMs + operationTimeoutMs) {
		throw new Error(
			'AFD_BA_DEADLINE_MS must exceed session expiry plus restart and operation budgets'
		);
	}
	return {
		mode: 'hosted',
		appURL: app.origin,
		providerId,
		callbackURL: callback.href,
		returnURL: destination.href,
		expectedEmail: env.AFD_BA_EXPECTED_EMAIL ?? '',
		revision: env.AFD_BA_REVISION ?? '',
		controlKey: env.AFD_BA_CONTROL_KEY ?? '',
		restartCommand,
		deadlineMs,
		operationTimeoutMs,
		restartTimeoutMs,
		sessionExpiresIn,
		sessionUpdateAge,
	};
}

/** Receipt allowlist: never serialize error objects, sessions, URLs with OAuth state, or env. */
export interface Receipt {
	schema: 1;
	mode: 'local' | 'hosted';
	provider: 'test-only-local-oauth-pkce' | 'configured-external-oidc';
	origin: string;
	revision: string;
	node: string;
	versions: Record<string, string>;
	browser: string;
	assertions: string[];
	result: 'passed' | 'failed' | 'partial';
	checks: Record<string, 'passed' | 'failed' | 'not-run'>;
	resourceCleanup: 'passed' | 'not-run';
	failurePhase?: string;
	interrupted?: boolean;
	cleanup: 'passed' | 'failed' | 'not-started';
}

export function receiptJSON(receipt: Receipt): string {
	return JSON.stringify(
		{
			schema: 1,
			mode: receipt.mode,
			provider: receipt.provider,
			origin: new URL(receipt.origin).origin,
			revision: receipt.revision,
			node: receipt.node,
			versions: receipt.versions,
			browser: receipt.browser,
			assertions: receipt.assertions,
			checks: receipt.checks,
			resourceCleanup: receipt.resourceCleanup,
			result: receipt.result,
			failurePhase: receipt.failurePhase,
			interrupted: receipt.interrupted,
			cleanup: receipt.cleanup,
		},
		null,
		2
	);
}

import { HttpAdapter } from '../dist/index.js';

const allowedPhases = new Set(['preflight', 'write', 'read', 'unavailable', 'cleanup']);

export class HarnessError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'HarnessError';
		this.code = code;
	}
}

function required(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new HarnessError('CONFIG', `${name} is required`);
	return value;
}

export function configuration() {
	const phase = required('AFD_TEST_HTTP_PHASE');
	if (!allowedPhases.has(phase)) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_PHASE must be preflight, write, read, unavailable, or cleanup'
		);
	}
	const baseURL = validatedBaseURL(required('AFD_TEST_HTTP_BASE_URL'));
	const table = required('AFD_TEST_HTTP_TABLE');
	const runId = required('AFD_TEST_HTTP_RUN_ID');
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/.test(runId)) {
		throw new HarnessError('CONFIG', 'AFD_TEST_HTTP_RUN_ID must be 8-80 safe marker characters');
	}
	if (
		['settings', 'flags', 'feature_flags', 'feature_data', 'keyboard_shortcuts'].includes(table)
	) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_TABLE must be an entity table where missing PATCH returns 404'
		);
	}
	const deadlineMs = Number(process.env.AFD_TEST_HTTP_DEADLINE_MS ?? '5000');
	if (!Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 60_000) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_DEADLINE_MS must be an integer from 100 to 60000'
		);
	}
	const token = process.env.AFD_TEST_HTTP_TOKEN?.trim();
	const secondaryToken = process.env.AFD_TEST_HTTP_SECONDARY_TOKEN?.trim();
	if ((token && !secondaryToken) || (!token && secondaryToken)) {
		throw new HarnessError(
			'CONFIG',
			'Authenticated runs require both primary and secondary synthetic-principal tokens'
		);
	}
	if (token && token === secondaryToken) {
		throw new HarnessError('CONFIG', 'Synthetic principals must use distinct tokens');
	}
	const appRevision = ['write', 'read'].includes(phase)
		? required('AFD_TEST_HTTP_APP_REVISION')
		: process.env.AFD_TEST_HTTP_APP_REVISION?.trim();
	const restartAck = process.env.AFD_TEST_HTTP_RESTART_ACK?.trim();
	if (
		phase === 'read' &&
		(!restartAck || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(restartAck))
	) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_RESTART_ACK must identify the completed external restart for the read phase'
		);
	}
	const unavailableAck = process.env.AFD_TEST_HTTP_UNAVAILABLE_ACK?.trim();
	if (
		phase === 'unavailable' &&
		(!unavailableAck || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(unavailableAck))
	) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_UNAVAILABLE_ACK must identify the controlled outage'
		);
	}
	const unavailableHttpStatus = process.env.AFD_TEST_HTTP_UNAVAILABLE_HTTP_STATUS?.trim();
	if (phase === 'unavailable' && unavailableHttpStatus && unavailableHttpStatus !== '503') {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_UNAVAILABLE_HTTP_STATUS must be exactly 503 when set'
		);
	}
	return {
		phase,
		baseURL,
		table,
		runId,
		deadlineMs,
		token,
		secondaryToken,
		expectFixtureAuth: process.env.AFD_TEST_HTTP_EXPECT_FIXTURE_AUTH === '1',
		expectedStoreId: process.env.AFD_TEST_HTTP_STORE_ID?.trim(),
		appRevision,
		restartAck,
		unavailableAck,
		unavailableHttpStatus: unavailableHttpStatus ? Number(unavailableHttpStatus) : undefined,
	};
}

function validatedBaseURL(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new HarnessError('CONFIG', 'AFD_TEST_HTTP_BASE_URL must be a valid absolute URL');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_BASE_URL must be an HTTP(S) URL without credentials'
		);
	}
	const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
	if (url.protocol !== 'https:' && !loopback) {
		throw new HarnessError(
			'CONFIG',
			'AFD_TEST_HTTP_BASE_URL must use HTTPS unless it targets a loopback fixture'
		);
	}
	if (url.search || url.hash) {
		throw new HarnessError('CONFIG', 'AFD_TEST_HTTP_BASE_URL cannot contain a query or fragment');
	}
	return url.toString().replace(/\/$/, '');
}

export function idsFor(runId) {
	const prefix = `afd362-${runId}`;
	return {
		marker: `${prefix}-marker`,
		base: `${prefix}-base`,
		queryA: `${prefix}-query-a`,
		queryB: `${prefix}-query-b`,
		queryC: `${prefix}-query-c`,
		batch: `${prefix}-batch`,
		batchUpsert: `${prefix}-batch-upsert`,
		batchOld: `${prefix}-batch-old`,
		rollback: `${prefix}-rollback`,
		missing: `${prefix}-missing`,
		encoded: `${prefix}-record/with spaces?#`,
		removed: `${prefix}-removed`,
		view: `${prefix}-view`,
		isolation: `${prefix}-isolation`,
	};
}

function fetchFor(config, token, observation) {
	return async (input, init = {}) => {
		const headers = new Headers(init.headers);
		if (token) headers.set('authorization', `Bearer ${token}`);
		const deadline = AbortSignal.timeout(config.deadlineMs);
		const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
		if (observation) observation.requestStarted = true;
		try {
			const response = await fetch(input, {
				...init,
				headers,
				signal,
				...(config.phase === 'unavailable' ? { redirect: 'manual' } : {}),
			});
			if (observation) {
				observation.responseReceived = true;
				observation.responseStatus = response.status;
			}
			return response;
		} catch (error) {
			if (observation) {
				observation.fetchRejected = true;
				observation.aborted = signal.aborted;
			}
			throw error;
		}
	};
}

export function adapterFor(config, token = config.token, observation) {
	return new HttpAdapter(config.baseURL, { fetch: fetchFor(config, token, observation) });
}

export function check(condition, message) {
	if (!condition) throw new HarnessError('ASSERTION', message);
}

export function equal(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new HarnessError('ASSERTION', message);
	}
}

export function handler(initial) {
	const result = {
		state: structuredClone(initial),
		get: () => structuredClone(result.state),
		set: (partial) => Object.assign(result.state, structuredClone(partial)),
		replace: (state) => {
			result.state = structuredClone(state);
		},
	};
	return result;
}

export function entityPath(table, id) {
	return `/${encodeURIComponent(table)}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`;
}

export function storeIdentity(config, health) {
	const serviceIdentity = typeof health.storeId === 'string' ? health.storeId : undefined;
	const identity = config.expectedStoreId ?? serviceIdentity;
	if (!identity) {
		throw new HarnessError(
			'CONFIG',
			'Set AFD_TEST_HTTP_STORE_ID when the hosted health response does not expose a stable storeId'
		);
	}
	if (config.expectedStoreId && serviceIdentity && config.expectedStoreId !== serviceIdentity) {
		throw new HarnessError(
			'ASSERTION',
			'Configured and service-reported store identities disagree'
		);
	}
	return identity;
}

export async function expectHttpFailure(promise, status, label) {
	try {
		await promise;
	} catch (error) {
		check(
			error && typeof error === 'object' && error.status === status,
			`${label} returned the wrong failure status`
		);
		return;
	}
	throw new HarnessError('ASSERTION', `${label} unexpectedly succeeded`);
}

export async function assertAbsent(db, table, ids, label) {
	for (const id of ids)
		check((await db.get(table, id)) === null, `${label} found existing test ID ${id}`);
}

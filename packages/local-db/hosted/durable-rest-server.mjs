#!/usr/bin/env node
/** Node 24-only disposable REST fixture. This is test infrastructure, not a production server. */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const databasePath = required('AFD_FIXTURE_DB_PATH');
const tokenA = required('AFD_FIXTURE_TOKEN_A');
const tokenB = required('AFD_FIXTURE_TOKEN_B');
const host = process.env.AFD_FIXTURE_HOST ?? '127.0.0.1';
const port = parsePort(process.env.AFD_FIXTURE_PORT ?? '0');
const apiBase = normalizeBase(process.env.AFD_FIXTURE_API_BASE ?? '/api/v1');
const startedAt = Date.now();
const instanceId = randomUUID();
const database = new DatabaseSync(databasePath);

database.exec(`
	PRAGMA journal_mode = WAL;
	PRAGMA foreign_keys = ON;
	CREATE TABLE IF NOT EXISTS fixture_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS fixture_records (
		tenant TEXT NOT NULL,
		table_name TEXT NOT NULL,
		record_id TEXT NOT NULL,
		value TEXT NOT NULL,
		PRIMARY KEY (tenant, table_name, record_id)
	);
`);

const readMeta = database.prepare('SELECT value FROM fixture_meta WHERE key = ?');
const writeMeta = database.prepare('INSERT INTO fixture_meta (key, value) VALUES (?, ?)');
let storeId = readMeta.get('store_id')?.value;
if (!storeId) {
	storeId = randomUUID();
	writeMeta.run('store_id', storeId);
}

const statements = {
	get: database.prepare(
		'SELECT value FROM fixture_records WHERE tenant = ? AND table_name = ? AND record_id = ?'
	),
	list: database.prepare(
		'SELECT value FROM fixture_records WHERE tenant = ? AND table_name = ? ORDER BY rowid'
	),
	insert: database.prepare(
		'INSERT INTO fixture_records (tenant, table_name, record_id, value) VALUES (?, ?, ?, ?)'
	),
	upsert: database.prepare(`
		INSERT INTO fixture_records (tenant, table_name, record_id, value) VALUES (?, ?, ?, ?)
		ON CONFLICT (tenant, table_name, record_id) DO UPDATE SET value = excluded.value
	`),
	delete: database.prepare(
		'DELETE FROM fixture_records WHERE tenant = ? AND table_name = ? AND record_id = ?'
	),
	tables: database.prepare(
		'SELECT COUNT(DISTINCT table_name) AS count FROM fixture_records WHERE tenant = ?'
	),
};

class ServiceError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function required(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function parsePort(value) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
		throw new Error('AFD_FIXTURE_PORT must be an integer from 0 to 65535');
	}
	return parsed;
}

function normalizeBase(value) {
	if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
		throw new Error('AFD_FIXTURE_API_BASE must be an absolute URL path');
	}
	return value.replace(/\/$/, '');
}

function principalFor(request) {
	const authorization = request.headers.authorization;
	if (authorization === `Bearer ${tokenA}`) return 'principal-a';
	if (authorization === `Bearer ${tokenB}`) return 'principal-b';
	throw new ServiceError(401, 'UNAUTHORIZED', 'A valid fixture bearer token is required');
}

function parseTarget(url) {
	if (!url.pathname.startsWith(`${apiBase}/`)) {
		throw new ServiceError(404, 'NOT_FOUND', 'Unknown fixture route');
	}
	const encoded = url.pathname.slice(apiBase.length + 1).split('/');
	if (encoded.length > 2) throw new ServiceError(400, 'INVALID_PATH', 'Malformed fixture path');
	try {
		const [table = '', id] = encoded.map(decodeURIComponent);
		if (!table || table === '.' || table === '..') {
			throw new ServiceError(400, 'INVALID_NAME', 'Invalid table name');
		}
		if (id !== undefined && (!id || id === '.' || id === '..')) {
			throw new ServiceError(400, 'INVALID_NAME', 'Invalid record ID');
		}
		return { table, id };
	} catch (error) {
		if (error instanceof ServiceError) throw error;
		throw new ServiceError(400, 'INVALID_PATH', 'Malformed percent encoding');
	}
}

async function readBody(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 1_048_576) throw new ServiceError(413, 'TOO_LARGE', 'Request body is too large');
		chunks.push(chunk);
	}
	if (!chunks.length) return undefined;
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new ServiceError(400, 'INVALID_JSON', 'Request body must be JSON');
	}
}

function recordFor(tenant, table, id) {
	const row = statements.get.get(tenant, table, id);
	return row ? JSON.parse(row.value) : null;
}

function requireObject(value, message) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ServiceError(400, 'INVALID_BODY', message);
	}
	return value;
}

function listRecords(tenant, table, searchParams) {
	let rows = statements.list.all(tenant, table).map((row) => JSON.parse(row.value));
	const reserved = new Set(['sort', 'order', 'limit', 'offset']);
	for (const [key, value] of searchParams) {
		if (!reserved.has(key)) rows = rows.filter((row) => String(row[key]) === value);
	}
	const total = rows.length;
	const sort = searchParams.get('sort');
	if (sort) {
		const direction = searchParams.get('order') === 'desc' ? -1 : 1;
		rows.sort((left, right) => {
			if (left[sort] === right[sort]) return 0;
			return left[sort] < right[sort] ? -direction : direction;
		});
	}
	const offset = numberParam(searchParams, 'offset', 0);
	const limit = numberParam(searchParams, 'limit', rows.length);
	return { data: rows.slice(offset, offset + limit), total };
}

function numberParam(searchParams, key, fallback) {
	if (!searchParams.has(key)) return fallback;
	const value = Number(searchParams.get(key));
	if (!Number.isInteger(value) || value < 0) {
		throw new ServiceError(400, 'INVALID_QUERY', `${key} must be a nonnegative integer`);
	}
	return value;
}

function applyOperation(tenant, method, table, id, body, searchParams = new URLSearchParams()) {
	if (method === 'GET' && id === undefined) {
		return { status: 200, data: listRecords(tenant, table, searchParams) };
	}
	if (method === 'GET') {
		const value = recordFor(tenant, table, id);
		return value === null ? { status: 404, data: null } : { status: 200, data: value };
	}
	if (method === 'POST' && id === undefined) {
		const record = requireObject(body, 'Create body must be an object');
		if (typeof record.id !== 'string' || !record.id) {
			throw new ServiceError(400, 'INVALID_BODY', 'Create body needs a nonempty string id');
		}
		if (recordFor(tenant, table, record.id)) {
			throw new ServiceError(409, 'CONFLICT', 'Record already exists');
		}
		statements.insert.run(tenant, table, record.id, JSON.stringify(record));
		return { status: 201, data: record };
	}
	if ((method === 'PATCH' || method === 'PUT') && id !== undefined) {
		const patch = requireObject(body, 'Update body must be an object');
		const existing = recordFor(tenant, table, id);
		if (existing === null && method === 'PATCH') {
			throw new ServiceError(404, 'NOT_FOUND', 'Record does not exist');
		}
		const record = { ...(existing ?? {}), ...patch, id };
		statements.upsert.run(tenant, table, id, JSON.stringify(record));
		return { status: 200, data: record };
	}
	if (method === 'DELETE' && id !== undefined) {
		statements.delete.run(tenant, table, id);
		return { status: 204 };
	}
	throw new ServiceError(400, 'INVALID_OPERATION', 'Unsupported method or path');
}

function applyBatch(tenant, operations) {
	if (!Array.isArray(operations))
		throw new ServiceError(400, 'INVALID_BODY', 'operations must be an array');
	database.exec('BEGIN IMMEDIATE');
	const results = [];
	let failedIndex = -1;
	try {
		for (const [index, operation] of operations.entries()) {
			try {
				const input = requireObject(operation, 'Batch operation must be an object');
				const target = parseTarget(new URL(`${apiBase}${input.path}`, 'http://fixture.test'));
				results.push(applyOperation(tenant, input.method, target.table, target.id, input.body));
			} catch (error) {
				const failure = serviceError(error);
				results.push({ status: failure.status, error: failure.code });
				failedIndex = index;
				break;
			}
		}
		if (failedIndex >= 0) {
			database.exec('ROLLBACK');
			return {
				results: operations.map((_, index) =>
					index === failedIndex ? results[index] : { status: 424, error: 'FAILED_DEPENDENCY' }
				),
				summary: { total: operations.length, success: 0, failed: operations.length },
			};
		}
		database.exec('COMMIT');
		return {
			results,
			summary: { total: operations.length, success: operations.length, failed: 0 },
		};
	} catch (error) {
		try {
			database.exec('ROLLBACK');
		} catch {}
		throw error;
	}
}

function serviceError(error) {
	if (error instanceof ServiceError) return error;
	return new ServiceError(500, 'INTERNAL', 'Fixture operation failed');
}

function send(response, status, body) {
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(status === 204 ? undefined : JSON.stringify(body));
}

const server = createServer(async (request, response) => {
	try {
		const tenant = principalFor(request);
		const requestedPrincipal = request.headers['x-afd-test-principal'];
		if (requestedPrincipal && requestedPrincipal !== tenant) {
			throw new ServiceError(403, 'FORBIDDEN', 'A token cannot select another principal');
		}
		const url = new URL(request.url ?? '/', 'http://fixture.test');
		const body = await readBody(request);
		const target = parseTarget(url);
		if (target.table === 'health' && target.id === undefined && request.method === 'GET') {
			return send(response, 200, {
				status: 'ok',
				version: 1,
				tables: Number(statements.tables.get(tenant).count),
				uptime: Date.now() - startedAt,
				storeId,
				instanceId,
			});
		}
		if (target.table === 'batch' && target.id === undefined && request.method === 'POST') {
			return send(response, 200, applyBatch(tenant, body?.operations));
		}
		const result = applyOperation(
			tenant,
			request.method ?? 'GET',
			target.table,
			target.id,
			body,
			url.searchParams
		);
		return send(response, result.status, result.data);
	} catch (error) {
		const failure = serviceError(error);
		return send(response, failure.status, { error: failure.code });
	}
});

server.listen(port, host, () => {
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
	process.stdout.write(
		`${JSON.stringify({ event: 'ready', baseURL: `http://${host}:${address.port}${apiBase}`, storeId, instanceId })}\n`
	);
});

function shutdown() {
	server.closeAllConnections();
	server.close(() => {
		database.close();
		process.exit(0);
	});
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { assertValidName, DataAdapterError, UPSERT_TABLES } from './adapter-support.js';
import type {
	BatchOperation,
	BatchResult,
	DataAdapter,
	HealthStatus,
	ListResult,
	QueryParams,
} from './types.js';

/** Table name → API path mapping. Override via constructor options. */
const DEFAULT_PATH_MAP: Readonly<Record<string, string>> = {
	accounts: '/accounts',
	settings: '/settings',
	flags: '/flags',
	feature_flags: '/flags',
	recent_items: '/recent-items',
	annotations: '/annotations',
	feature_data: '/feature-data',
	chat_sessions: '/chat/sessions',
	chat_messages: '/chat/messages',
	keyboard_shortcuts: '/shortcuts',
};

export interface HttpAdapterOptions {
	/** Custom table → path mappings (merged with defaults). */
	pathMap?: Record<string, string>;
	/** Custom fetch implementation (for testing or Node environments). */
	fetch?: typeof globalThis.fetch;
}

/** One percent-encoded path segment for a table or record name. */
function segment(kind: 'table' | 'record id', value: string): string {
	assertValidName(kind, value);
	return encodeURIComponent(value);
}

/**
 * HTTP-based DataAdapter that talks to a REST API server.
 *
 * Works with any backend that follows the REST conventions:
 * - GET /path — list
 * - GET /path/:id — get
 * - POST /path — create
 * - PUT|PATCH /path/:id — update
 * - DELETE /path/:id — delete
 * - POST /batch — atomic batch
 * - GET /health — health check
 *
 * A table without a `pathMap` entry is sent as one percent-encoded path segment, so names such
 * as `constructor` or `../admin` stay inside the base path. Failures reject with a
 * `DataAdapterError` carrying the HTTP `status`.
 */
export class HttpAdapter implements DataAdapter {
	private readonly baseUrl: string;
	private readonly pathMap: Record<string, string>;
	private readonly fetchFn: typeof globalThis.fetch;

	constructor(baseUrl = '/api/v1', options?: HttpAdapterOptions) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.pathMap = { ...DEFAULT_PATH_MAP, ...options?.pathMap };
		this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
	}

	private resolvePath(table: string): string {
		const mapped = Object.hasOwn(this.pathMap, table) ? this.pathMap[table] : undefined;
		return mapped ?? `/${segment('table', table)}`;
	}

	private recordPath(table: string, id: string): string {
		return `${this.resolvePath(table)}/${segment('record id', id)}`;
	}

	private url(path: string, params?: Record<string, string>): string {
		const base = `${this.baseUrl}${path}`;
		if (!params || Object.keys(params).length === 0) return base;
		const qs = new URLSearchParams(params).toString();
		return `${base}?${qs}`;
	}

	private async request<T>(
		url: string,
		init?: RequestInit,
		options?: { allowNotFound?: boolean }
	): Promise<T> {
		const res = await this.fetchFn(url, init);
		if (!res.ok) {
			if (res.status === 404 && options?.allowNotFound) return null as T;
			const body = await res.text().catch(() => '');
			throw new DataAdapterError(res.status, `HTTP ${res.status}: ${body || res.statusText}`);
		}
		if (res.status === 204) return undefined as T;
		return res.json() as Promise<T>;
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		return this.request<T | null>(this.url(this.recordPath(table, id)), undefined, {
			allowNotFound: true,
		});
	}

	async list<T>(table: string, params?: QueryParams): Promise<ListResult<T>> {
		const path = this.resolvePath(table);
		const queryParams: Record<string, string> = {};
		if (params) {
			for (const [key, value] of Object.entries(params)) {
				if (value !== undefined) queryParams[key] = String(value);
			}
		}
		return this.request<ListResult<T>>(this.url(path, queryParams));
	}

	async create<T>(table: string, data: Partial<T>): Promise<T> {
		const path = this.resolvePath(table);
		return this.request<T>(this.url(path), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
	}

	/**
	 * Update a record: `PUT` (upsert) for the upsert tables such as `settings`, otherwise `PATCH`,
	 * which rejects with a 404 `DataAdapterError` for a missing record.
	 */
	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		const method = UPSERT_TABLES.has(table) ? 'PUT' : 'PATCH';
		return this.request<T>(this.url(this.recordPath(table, id)), {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		});
	}

	/** Delete a record. Deleting a record that does not exist (404) succeeds, as in `MemoryAdapter`. */
	async remove(table: string, id: string): Promise<void> {
		await this.request<void>(
			this.url(this.recordPath(table, id)),
			{ method: 'DELETE' },
			{ allowNotFound: true }
		);
	}

	/**
	 * Send the operations to `POST /batch` in one request. Atomicity is the server's job: it
	 * must apply all operations or none, as `DataAdapter.batch()` describes.
	 */
	async batch(operations: BatchOperation[]): Promise<BatchResult> {
		return this.request<BatchResult>(this.url('/batch'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ operations }),
		});
	}

	async health(): Promise<HealthStatus> {
		return this.request<HealthStatus>(this.url('/health'));
	}
}

/** Convenience factory for creating an HttpAdapter. */
export function createHttpAdapter(baseUrl = '/api/v1', options?: HttpAdapterOptions): HttpAdapter {
	return new HttpAdapter(baseUrl, options);
}

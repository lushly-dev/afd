import type {
	BatchOperation,
	BatchResult,
	DataAdapter,
	HealthStatus,
	ListResult,
	QueryParams,
} from './types.js';

/** Table name → API path mapping. Override via constructor options. */
const DEFAULT_PATH_MAP: Record<string, string> = {
	accounts: '/accounts',
	settings: '/settings',
	flags: '/flags',
	feature_flags: '/flags',
	recent_items: '/recent-items',
	annotations: '/annotations',
	feature_data: '/feature-data',
	chat_sessions: '/chat/sessions',
	chat_messages: '/chat/sessions',
	keyboard_shortcuts: '/shortcuts',
};

/** Tables that use PUT (upsert) instead of PATCH for updates. */
const UPSERT_TABLES = new Set([
	'settings',
	'flags',
	'feature_flags',
	'feature_data',
	'keyboard_shortcuts',
]);

export interface HttpAdapterOptions {
	/** Custom table → path mappings (merged with defaults). */
	pathMap?: Record<string, string>;
	/** Custom fetch implementation (for testing or Node environments). */
	fetch?: typeof globalThis.fetch;
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
		return this.pathMap[table] ?? `/${table}`;
	}

	private url(path: string, params?: Record<string, string>): string {
		const base = `${this.baseUrl}${path}`;
		if (!params || Object.keys(params).length === 0) return base;
		const qs = new URLSearchParams(params).toString();
		return `${base}?${qs}`;
	}

	private async request<T>(url: string, init?: RequestInit): Promise<T> {
		const res = await this.fetchFn(url, init);
		if (!res.ok) {
			if (res.status === 404) return null as T;
			const body = await res.text().catch(() => '');
			throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
		}
		if (res.status === 204) return undefined as T;
		return res.json() as Promise<T>;
	}

	async get<T>(table: string, id: string): Promise<T | null> {
		const path = this.resolvePath(table);
		return this.request<T | null>(this.url(`${path}/${id}`));
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

	async update<T>(table: string, id: string, patch: Partial<T>): Promise<T> {
		const path = this.resolvePath(table);
		const method = UPSERT_TABLES.has(table) ? 'PUT' : 'PATCH';
		return this.request<T>(this.url(`${path}/${id}`), {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		});
	}

	async remove(table: string, id: string): Promise<void> {
		const path = this.resolvePath(table);
		await this.request<void>(this.url(`${path}/${id}`), { method: 'DELETE' });
	}

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

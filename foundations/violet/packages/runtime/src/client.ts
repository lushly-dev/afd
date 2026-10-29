/**
 * Violet Runtime Client
 *
 * Main client for loading and managing design tokens.
 */

import { TokenCache } from './cache.js';
import type {
	ApiResponse,
	CacheEntry,
	RuntimeEvent,
	RuntimeEventData,
	RuntimeEventListener,
	Token,
	TokensResponse,
	VioletConfig,
} from './types.js';

/**
 * Default configuration values. The empty apiUrl means the page's own origin;
 * there is no default remote host, so an API key is only ever sent to a URL
 * the caller chose.
 */
const DEFAULT_CONFIG: Required<Omit<VioletConfig, 'nodeId' | 'apiKey'>> = {
	apiUrl: '',
	cacheEnabled: true,
	cacheTtl: 3600,
	autoApply: true,
	cssPrefix: '',
	timeout: 10_000,
};

/**
 * Convert a glob pattern (where `*` matches any characters) into an anchored,
 * fully escaped RegExp. All other characters are matched literally.
 */
function globToRegExp(pattern: string): RegExp {
	const source = pattern
		.split('*')
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
		.join('.*');
	return new RegExp(`^${source}$`);
}

/**
 * VioletRuntime - Web SDK for dynamic token loading and application.
 *
 * @example
 * ```ts
 * const violet = new VioletRuntime({
 *   nodeId: "xbox-web-dark",
 *   apiUrl: "https://violet.example.com",
 *   apiKey: "your-api-key",
 * });
 *
 * // Load tokens from API
 * await violet.load();
 *
 * // Get a specific token
 * const primary = violet.get("color.brand.primary");
 *
 * // Apply to document as CSS variables
 * violet.applyToDocument();
 *
 * // Switch to different theme
 * await violet.switchNode("xbox-web-light");
 * ```
 */
export class VioletRuntime {
	private config: Required<VioletConfig>;
	private cache: TokenCache;
	private tokens: Map<string, Token> = new Map();
	private currentNodeId: string;
	private listeners: Map<RuntimeEvent, Set<RuntimeEventListener>> = new Map();
	private initialized = false;
	/**
	 * Incremented by every load()/switchNode(). A request only applies its
	 * result if no newer request has started since (latest request wins).
	 */
	private generation = 0;

	constructor(config: VioletConfig) {
		if (config.apiKey && !config.apiUrl?.trim()) {
			throw new Error(
				'VioletRuntime: apiUrl is required when apiKey is set. Pass the URL of your Violet deployment, for example { apiUrl: "https://violet.example.com", apiKey }.',
			);
		}
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			apiKey: config.apiKey ?? '',
		};
		this.currentNodeId = config.nodeId;
		this.cache = new TokenCache();
	}

	/**
	 * Initialize the runtime (call once before using).
	 */
	async init(): Promise<void> {
		if (this.initialized) return;

		if (this.config.cacheEnabled) {
			await this.cache.init();
		}
		this.initialized = true;
	}

	/**
	 * Load tokens from API or cache.
	 * Automatically applies tokens if autoApply is enabled.
	 */
	async load(): Promise<Token[]> {
		await this.init();

		const generation = ++this.generation;
		const nodeId = this.currentNodeId;
		const { tokens, fromCache } = await this.resolveTokens(nodeId);

		// A newer load()/switchNode() has started: don't clobber its state.
		if (generation !== this.generation) return tokens;

		this.setTokens(tokens);
		if (!fromCache) {
			this.emit('load', { tokens });
		}

		if (this.config.autoApply) {
			this.applyToDocument();
		}

		return tokens;
	}

	/**
	 * Get a token by ID.
	 */
	get(tokenId: string): Token | undefined {
		return this.tokens.get(tokenId);
	}

	/**
	 * Get token value directly.
	 */
	getValue(tokenId: string): string | number | Record<string, unknown> | undefined {
		return this.tokens.get(tokenId)?.value;
	}

	/**
	 * Get all loaded tokens.
	 */
	getAll(): Token[] {
		return Array.from(this.tokens.values());
	}

	/**
	 * Get tokens whose ID matches a glob pattern. `*` matches any characters;
	 * everything else is literal and the whole ID must match
	 * (`color.*` matches `color.primary` but not `bgcolor.primary`).
	 */
	getByPattern(pattern: string): Token[] {
		const regex = globToRegExp(pattern);
		return this.getAll().filter((token) => regex.test(token.id));
	}

	/**
	 * Apply tokens to document as CSS custom properties.
	 */
	applyToDocument(): void {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;
		const prefix = this.config.cssPrefix;

		for (const token of this.tokens.values()) {
			if (typeof token.value === 'string' || typeof token.value === 'number') {
				const varName = this.tokenToCssVar(token.id, prefix);
				root.style.setProperty(varName, String(token.value));
			}
		}
	}

	/**
	 * Remove tokens from document.
	 */
	removeFromDocument(): void {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;
		const prefix = this.config.cssPrefix;

		for (const token of this.tokens.values()) {
			if (typeof token.value === 'string' || typeof token.value === 'number') {
				const varName = this.tokenToCssVar(token.id, prefix);
				root.style.removeProperty(varName);
			}
		}
	}

	/**
	 * Switch to a different node (e.g., theme switch).
	 */
	async switchNode(nodeId: string): Promise<Token[]> {
		await this.init();

		const generation = ++this.generation;
		const previousNodeId = this.currentNodeId;

		// Resolve first: if this fails (network, API error) nothing has changed -
		// the previous theme stays applied and currentNodeId is untouched.
		const { tokens, fromCache } = await this.resolveTokens(nodeId);

		// A newer load()/switchNode() has started: this result is stale.
		if (generation !== this.generation) return tokens;

		// Commit: remove old tokens, then apply the new ones.
		this.removeFromDocument();
		this.currentNodeId = nodeId;
		this.setTokens(tokens);
		if (!fromCache) {
			this.emit('load', { tokens });
		}

		if (this.config.autoApply) {
			this.applyToDocument();
		}

		this.emit('theme:change', {
			from: previousNodeId,
			to: nodeId,
			tokens,
		});

		return tokens;
	}

	/**
	 * Get current node ID.
	 */
	getCurrentNodeId(): string {
		return this.currentNodeId;
	}

	/**
	 * Preload tokens for a node without applying.
	 */
	async preload(nodeId: string): Promise<void> {
		await this.init();

		if (this.config.cacheEnabled) {
			const cached = await this.readCache(nodeId);
			if (cached && !this.cache.isExpired(cached)) {
				return; // Already cached
			}
		}

		const tokens = await this.fetchTokens(nodeId);

		if (this.config.cacheEnabled) {
			await this.writeCache(nodeId, tokens);
		}
	}

	/**
	 * Invalidate cache for current or specified node.
	 */
	async invalidateCache(nodeId?: string): Promise<void> {
		await this.cache.delete(this.cacheKey(nodeId ?? this.currentNodeId));
	}

	/**
	 * Clear all cached tokens.
	 */
	async clearCache(): Promise<void> {
		await this.cache.clear();
	}

	/**
	 * Subscribe to runtime events.
	 */
	on(event: RuntimeEvent, listener: RuntimeEventListener): () => void {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, new Set());
		}
		this.listeners.get(event)?.add(listener);

		// Return unsubscribe function
		return () => {
			this.listeners.get(event)?.delete(listener);
		};
	}

	/**
	 * Emit an event to listeners.
	 */
	private emit(type: RuntimeEvent, data: unknown, nodeId: string = this.currentNodeId): void {
		const eventData: RuntimeEventData = {
			type,
			nodeId,
			timestamp: Date.now(),
			data,
		};

		const listeners = this.listeners.get(type);
		if (listeners) {
			for (const listener of listeners) {
				try {
					listener(eventData);
				} catch {
					// Don't let listener errors break the runtime
				}
			}
		}
	}

	/**
	 * Set tokens in internal map.
	 */
	private setTokens(tokens: Token[]): void {
		this.tokens.clear();
		for (const token of tokens) {
			this.tokens.set(token.id, token);
		}
	}

	/**
	 * Convert token ID to CSS variable name.
	 */
	private tokenToCssVar(tokenId: string, prefix: string): string {
		const name = tokenId.replace(/\./g, '-');
		return prefix ? `--${prefix}-${name}` : `--${name}`;
	}

	/**
	 * Cache key for a node. Includes the API URL so tokens from different
	 * backends (staging/production) never collide.
	 */
	private cacheKey(nodeId: string): string {
		return `${this.config.apiUrl.replace(/\/+$/, '')}::${nodeId}`;
	}

	/**
	 * Read from the cache. Cache I/O is best-effort: failures count as a miss.
	 */
	private async readCache(nodeId: string): Promise<CacheEntry | null> {
		try {
			return await this.cache.get(this.cacheKey(nodeId));
		} catch {
			return null;
		}
	}

	/**
	 * Write to the cache. Cache I/O is best-effort (e.g. storage quota errors
	 * must not break loading). Returns whether the write succeeded.
	 */
	private async writeCache(nodeId: string, tokens: Token[]): Promise<boolean> {
		try {
			await this.cache.set(this.cacheKey(nodeId), tokens, this.config.cacheTtl);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Resolve tokens for a node from cache or API without touching runtime
	 * state (tokens, currentNodeId, document).
	 */
	private async resolveTokens(nodeId: string): Promise<{ tokens: Token[]; fromCache: boolean }> {
		if (this.config.cacheEnabled) {
			const cached = await this.readCache(nodeId);
			if (cached && !this.cache.isExpired(cached)) {
				this.emit('cache:hit', { tokens: cached.tokens }, nodeId);
				return { tokens: cached.tokens, fromCache: true };
			}
			this.emit('cache:miss', {}, nodeId);
		}

		const tokens = await this.fetchTokens(nodeId);

		if (this.config.cacheEnabled && (await this.writeCache(nodeId, tokens))) {
			this.emit('cache:update', { tokens }, nodeId);
		}

		return { tokens, fromCache: false };
	}

	/**
	 * Fetch tokens from API (with timeout). Emits `load:error` exactly once on failure.
	 */
	private async fetchTokens(nodeId: string): Promise<Token[]> {
		const url = `${this.config.apiUrl}/api/v1/nodes/${encodeURIComponent(nodeId)}/tokens`;

		const headers: HeadersInit = {
			'Content-Type': 'application/json',
		};

		if (this.config.apiKey) {
			headers['X-API-Key'] = this.config.apiKey;
		}

		const timeout = this.config.timeout ?? DEFAULT_CONFIG.timeout;
		const controller = new AbortController();
		let timedOut = false;
		const timer =
			timeout > 0
				? setTimeout(() => {
						timedOut = true;
						controller.abort();
					}, timeout)
				: undefined;

		try {
			const response = await fetch(url, { headers, signal: controller.signal });

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const result: ApiResponse<TokensResponse> = await response.json();

			if (!result.success || !result.data) {
				const error = result.error ?? {
					code: 'UNKNOWN',
					message: 'Unknown error',
				};
				throw new Error(`${error.code}: ${error.message}`);
			}

			return result.data.tokens;
		} catch (caught) {
			const error = timedOut ? new Error(`Request timed out after ${timeout}ms: ${url}`) : caught;
			this.emit('load:error', error, nodeId);
			throw error;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
}

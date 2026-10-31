/**
 * Violet Runtime Types
 *
 * Core type definitions for the Web SDK.
 */

/**
 * Configuration for VioletRuntime
 */
export interface VioletConfig {
	/**
	 * Base URL of your Violet deployment. Required when `apiKey` is set; without
	 * a key it defaults to the page's own origin (relative `/api/v1/...` requests).
	 */
	apiUrl?: string;

	/** API key for authentication. Needs `apiUrl`, so the key never goes to a default host */
	apiKey?: string;

	/** Node ID to load tokens from (e.g., "xbox-web-dark") */
	nodeId: string;

	/** Enable local caching (default: true) */
	cacheEnabled?: boolean;

	/** Cache TTL in seconds (default: 3600 = 1 hour) */
	cacheTtl?: number;

	/** Auto-apply tokens as CSS variables on load (default: true) */
	autoApply?: boolean;

	/** CSS selector prefix for variables (default: empty) */
	cssPrefix?: string;

	/** Fetch timeout in milliseconds (default: 10000). Use 0 to disable. */
	timeout?: number;
}

/**
 * Resolved token with value and metadata
 */
export interface Token {
	/** Token ID (e.g., "color.brand.primary") */
	id: string;

	/** Resolved value */
	value: string | number | Record<string, unknown>;

	/** Node where token was resolved */
	resolvedAt: string;

	/** Token metadata */
	metadata?: TokenMetadata;
}

/**
 * Token metadata
 */
export interface TokenMetadata {
	description?: string;
	deprecated?: boolean;
	group?: string;
	type?: string;
	[key: string]: unknown;
}

/**
 * Theme definition
 */
export interface Theme {
	/** Theme node ID */
	nodeId: string;

	/** Display name */
	name: string;

	/** Optional description */
	description?: string;
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
	/** Cached tokens */
	tokens: Token[];

	/** Timestamp when cached */
	cachedAt: number;

	/** TTL in seconds */
	ttl: number;

	/** Node ID */
	nodeId: string;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		suggestion?: string;
	};
}

/**
 * Token resolution response
 */
export interface TokensResponse {
	tokens: Token[];
	nodeId: string;
	ancestry: string[];
	tokenCount: number;
}

/**
 * Event types for runtime events
 */
export type RuntimeEvent =
	| 'load'
	| 'load:error'
	| 'theme:change'
	| 'cache:hit'
	| 'cache:miss'
	| 'cache:update';

/**
 * Event listener callback
 */
export type RuntimeEventListener = (event: RuntimeEventData) => void;

/**
 * Event data payload
 */
export interface RuntimeEventData {
	type: RuntimeEvent;
	nodeId: string;
	timestamp: number;
	data?: unknown;
}

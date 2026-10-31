/**
 * @lushly-dev/violet-runtime - Web SDK for Violet Design Tokens
 *
 * Dynamic token loading, caching, and theme management for web applications.
 *
 * @example
 * ```ts
 * import { VioletRuntime, ThemeManager } from "@lushly-dev/violet-runtime";
 *
 * // Basic usage
 * const violet = new VioletRuntime({
 *   nodeId: "xbox-web-dark",
 *   apiUrl: "https://violet.example.com",
 *   apiKey: "your-api-key",
 * });
 * await violet.load();
 *
 * // With theme management
 * const themes = new ThemeManager(violet, {
 *   themes: [
 *     { nodeId: "brand-light", name: "Light" },
 *     { nodeId: "brand-dark", name: "Dark" },
 *   ],
 *   defaultTheme: "brand-light",
 * });
 * await themes.switch("brand-dark");
 * ```
 *
 * @packageDocumentation
 */

// Main client
export { VioletRuntime } from './client.js';

// Theme management
export { ThemeManager, type ThemeManagerOptions } from './theme.js';

// Cache (for advanced usage)
export { TokenCache } from './cache.js';

// Types
export type {
	VioletConfig,
	Token,
	TokenMetadata,
	Theme,
	CacheEntry,
	ApiResponse,
	TokensResponse,
	RuntimeEvent,
	RuntimeEventListener,
	RuntimeEventData,
} from './types.js';

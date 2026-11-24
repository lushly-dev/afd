/**
 * Violet Runtime Client
 *
 * Main client for loading and managing design tokens.
 */

import { TokenCache } from './cache.js';
import { tokenCustomProperty } from './property.js';
import type {
	ApiResponse,
	CacheEntry,
	RuntimeEvent,
	RuntimeEventData,
	RuntimeEventListener,
	Token,
	TokensResponse,
	VioletConfig,
	VioletHttpConfig,
	VioletTokenSource,
} from './types.js';

/**
 * Default configuration values. The empty apiUrl means the page's own origin;
 * there is no default remote host, so an API key is only ever sent to a URL
 * the caller chose.
 */
const DEFAULT_CONFIG: Required<Omit<VioletHttpConfig, 'nodeId' | 'apiKey' | 'source'>> = {
	apiUrl: '',
	cacheEnabled: true,
	cacheTtl: 3600,
	autoApply: true,
	cssPrefix: '',
	timeout: 10_000,
};

/**
 * The selector contract of `@lushly-dev/violet-elements`' generated theme stylesheet
 * (`src/theme/violet-theme-css.ts` there): a theme applies on `:root` and on every element marked
 * `data-violet-theme-root`, and a preset other than the default adds `[data-violet-theme="<preset>"]`
 * to both. It is reproduced here, not imported: violet-runtime must not depend on violet-elements
 * (Loam decision D50), so a change to that contract is made in both places.
 */
const THEME_ROOT_ATTRIBUTE = 'data-violet-theme-root';
const THEME_PRESET_ATTRIBUTE = 'data-violet-theme';
/** violet-elements' preset name rule. */
const PRESET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function themeSelector(preset: string | null): string {
	if (preset === null) return `:root,\n[${THEME_ROOT_ATTRIBUTE}]`;
	const selected = `[${THEME_PRESET_ATTRIBUTE}="${preset}"]`;
	return `:root${selected},\n[${THEME_ROOT_ATTRIBUTE}]${selected}`;
}

/** Options for `VioletRuntime.adopt()`. */
export interface VioletAdoptOptions {
	/**
	 * Apply the tokens only where this preset is selected, with `data-violet-theme="<preset>"` on
	 * the root element or on a `data-violet-theme-root` element. Omitted, they apply as the default
	 * preset: on `:root` and every theme root, whatever preset is selected.
	 */
	preset?: string;
}

/** By node type, so a document from another window (an iframe's) counts too. */
function isDocument(target: unknown): target is Document {
	return (target as Node | null)?.nodeType === 9;
}

/** By node type, so a shadow root from another window counts too. */
function isShadowRoot(target: unknown): target is ShadowRoot {
	return (target as Node | null)?.nodeType === 11 && 'host' in (target as object);
}

/**
 * The document `target` belongs to, which must have a window: a constructed sheet is made by a
 * window's `CSSStyleSheet` and can be adopted only within the document it was made for.
 */
function ownerDocumentOf(
	target: Document | ShadowRoot,
): Document & { defaultView: Window & typeof globalThis } {
	let ownerDocument: Document;
	if (isDocument(target)) ownerDocument = target;
	else if (isShadowRoot(target)) ownerDocument = target.ownerDocument;
	else throw new TypeError('VioletRuntime: the target must be a Document or a ShadowRoot.');
	if (ownerDocument.defaultView === null) {
		throw new TypeError(
			'VioletRuntime: this document has no window; a constructed stylesheet cannot be adopted into it.',
		);
	}
	return ownerDocument as Document & { defaultView: Window & typeof globalThis };
}

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
 * Validate a preloaded source and copy its tokens, so later changes to the
 * caller's array do not reach the runtime. A token without `resolvedAt` is
 * recorded as resolved at `nodeId`.
 */
function sourceTokens(source: VioletTokenSource, nodeId: string): Token[] {
	if (!source || !Array.isArray(source.tokens)) {
		throw new Error(
			`VioletRuntime: the source for "${nodeId}" must be { tokens: Token[] }, an array of resolved tokens such as { id: "color.brand", value: "#352064" }.`,
		);
	}
	return source.tokens.map((token, index) => {
		const value = token?.value;
		const valid =
			token !== null &&
			typeof token === 'object' &&
			typeof token.id === 'string' &&
			token.id !== '' &&
			(typeof value === 'string' ||
				(typeof value === 'number' && Number.isFinite(value)) ||
				(value !== null && typeof value === 'object' && !Array.isArray(value))) &&
			(token.resolvedAt === undefined || typeof token.resolvedAt === 'string');
		if (!valid) {
			throw new Error(
				`VioletRuntime: token ${index} in the source for "${nodeId}" needs a non-empty string id, a string, finite number or object value, and a string resolvedAt if any.`,
			);
		}
		return { ...token, resolvedAt: token.resolvedAt ?? nodeId };
	});
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
 * // Adopt one stylesheet holding them, kept current on every switch
 * violet.adopt(document);
 *
 * // Switch to different theme
 * await violet.switchNode("xbox-web-light");
 *
 * // Or apply preloaded tokens with no token server
 * const local = new VioletRuntime({ nodeId: "brand-dark", source: { tokens } });
 * await local.load();
 * await local.switchNode("brand-light", { tokens: lightTokens });
 * ```
 */
export class VioletRuntime {
	private config: Required<Omit<VioletHttpConfig, 'source'>>;
	/** Tokens for currentNodeId when created with a preloaded source; null over HTTP. */
	private source: Token[] | null = null;
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
	/** The preset `adopt()` applies the tokens as (null for the default); undefined until it is called. */
	private adoptedPreset: string | null | undefined = undefined;
	/** This runtime's stylesheet for each owner document it adopted into. */
	private sheets = new WeakMap<Document, CSSStyleSheet>();
	/** Every sheet in `sheets`, held weakly, to rewrite on every load and switch. */
	private sheetRefs = new Set<WeakRef<CSSStyleSheet>>();
	/** The document each sheet in `sheets` was made for, to forget a sheet that cannot be written. */
	private sheetDocuments = new WeakMap<CSSStyleSheet, Document>();
	/**
	 * The inline properties `applyToDocument()` wrote, on which element, as each read back, so
	 * `removeFromDocument()` removes those and nothing else: not the page's own, and nothing at
	 * all once `adopt()` is the path.
	 */
	private appliedInline: {
		root: HTMLElement;
		properties: Map<string, { written: string; previous: { value: string; priority: string } }>;
	} | null = null;

	constructor(config: VioletConfig) {
		if (config.source !== undefined) {
			if (config.apiUrl !== undefined || config.apiKey !== undefined) {
				throw new Error(
					'VioletRuntime: pass either source or apiUrl/apiKey, not both. A preloaded source makes no request; drop apiUrl and apiKey, or drop source to load over HTTP.',
				);
			}
			this.source = sourceTokens(config.source, config.nodeId);
		} else if (config.apiKey && !config.apiUrl?.trim()) {
			throw new Error(
				'VioletRuntime: apiUrl is required when apiKey is set. Pass the URL of your Violet deployment, for example { apiUrl: "https://violet.example.com", apiKey }.',
			);
		}
		const { source: _source, ...options } = config;
		this.config = {
			...DEFAULT_CONFIG,
			...options,
			apiKey: config.apiKey ?? '',
		};
		// A preloaded source is already in memory; a cached copy could only shadow it.
		if (this.source) this.config.cacheEnabled = false;
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
	 * Load tokens from the preloaded source, or from API or cache, and write them into every
	 * sheet `adopt()` made. Applies them as inline properties if autoApply is enabled and
	 * `adopt()` was never called.
	 */
	async load(): Promise<Token[]> {
		await this.init();

		const generation = ++this.generation;
		const nodeId = this.currentNodeId;
		const { tokens, fromCache } = this.source
			? { tokens: [...this.source], fromCache: false }
			: await this.resolveTokens(nodeId);

		// A newer load()/switchNode() has started: don't clobber its state.
		if (generation !== this.generation) return tokens;

		this.setTokens(tokens);
		if (!fromCache) {
			this.emit('load', { tokens });
		}

		this.applyLoaded();

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
	 * Adopt one constructed stylesheet holding the loaded tokens as custom properties into
	 * `target` (the document by default, or a shadow root), appending it once, and return it.
	 * Its selectors are `@lushly-dev/violet-elements`' theme contract: `:root` and every
	 * `[data-violet-theme-root]`, narrowed to `[data-violet-theme="<preset>"]` when `preset` is
	 * given. A document and its shadow roots share one sheet per runtime; each `load()` and
	 * `switchNode()` rewrites it, so every root that adopted it changes at once.
	 *
	 * No `<style>` element or inline style is written, so a page whose Content Security Policy
	 * forbids inline styles needs no exception. Once called, autoApply no longer writes inline
	 * properties, and those this runtime's `applyToDocument()` wrote are removed, since they would
	 * override the sheet; no other inline property is touched.
	 *
	 * The returned sheet is the runtime's: each load and switch rewrites it, so an edit made to it
	 * lasts only until then, and a repeated `adopt()` does not undo one.
	 *
	 * Throws when given a preset other than the one an earlier call gave: create another runtime
	 * for another preset. Throws a `TypeError` when `target` is neither a document nor a shadow
	 * root, or its document has no window (one made by `createHTMLDocument` or `DOMParser`, or an
	 * iframe's once the iframe is removed). A refused call changes nothing.
	 */
	adopt(target: Document | ShadowRoot = document, options: VioletAdoptOptions = {}): CSSStyleSheet {
		const preset = options.preset ?? null;
		if (preset !== null && !PRESET_NAME.test(preset)) {
			throw new Error(
				`VioletRuntime: the preset name "${preset}" must be letters, digits, '-' and '_', starting with a letter or digit.`,
			);
		}
		if (this.adoptedPreset !== undefined && this.adoptedPreset !== preset) {
			throw new Error(
				`VioletRuntime: this runtime adopts its tokens as ${this.adoptedPreset === null ? 'the default preset' : `preset "${this.adoptedPreset}"`}, not ${preset === null ? 'the default preset' : `"${preset}"`}. Create another VioletRuntime for another preset.`,
			);
		}
		const ownerDocument = ownerDocumentOf(target);
		const existing = this.sheets.get(ownerDocument);
		// A constructed sheet can be adopted only within the document it was made for.
		const sheet = existing ?? new ownerDocument.defaultView.CSSStyleSheet();
		if (existing === undefined) this.writeSheet(sheet, preset);
		if (!target.adoptedStyleSheets.includes(sheet)) {
			target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
		}
		// Recorded only once adopted, so a refused adoption leaves no state behind.
		if (existing === undefined) {
			this.sheets.set(ownerDocument, sheet);
			this.sheetDocuments.set(sheet, ownerDocument);
			this.pruneSheetRefs();
			this.sheetRefs.add(new WeakRef(sheet));
		}
		if (this.adoptedPreset === undefined) {
			this.adoptedPreset = preset;
			this.removeFromDocument();
		}
		return sheet;
	}

	/** Remove this runtime's sheet from `target`'s adopted sheets, if it is there. */
	unadopt(target: Document | ShadowRoot = document): void {
		if (!isDocument(target) && !isShadowRoot(target)) {
			throw new TypeError('VioletRuntime: the target must be a Document or a ShadowRoot.');
		}
		const sheet = this.sheets.get(isDocument(target) ? target : target.ownerDocument);
		if (sheet !== undefined && target.adoptedStyleSheets.includes(sheet)) {
			target.adoptedStyleSheets = target.adoptedStyleSheets.filter((adopted) => adopted !== sheet);
		}
	}

	/**
	 * Apply tokens to document as CSS custom properties.
	 *
	 * @deprecated Inline properties override every stylesheet and need the document's own style
	 * attribute, so they cannot be scoped to a subtree or shadow root. Use `adopt()`, which
	 * adopts one stylesheet with violet-elements' selectors and keeps it current. To be removed
	 * in a later release.
	 */
	applyToDocument(): void {
		if (typeof document === 'undefined') return;

		const root = document.documentElement;
		const prefix = this.config.cssPrefix;
		if (this.appliedInline?.root !== root) this.appliedInline = { root, properties: new Map() };
		const { properties } = this.appliedInline;

		for (const token of this.tokens.values()) {
			if (typeof token.value === 'string' || typeof token.value === 'number') {
				const varName = tokenCustomProperty(token.id, prefix);
				// The page's own value before the first write, restored by removeFromDocument().
				const previous = properties.get(varName)?.previous ?? {
					value: root.style.getPropertyValue(varName),
					priority: root.style.getPropertyPriority(varName),
				};
				root.style.setProperty(varName, String(token.value));
				properties.set(varName, { written: root.style.getPropertyValue(varName), previous });
			}
		}
	}

	/**
	 * Remove tokens from document.
	 *
	 * Undoes only what `applyToDocument()` wrote: a property that still holds the written value
	 * gets back the value the page had before the first write (or is removed if it had none), and a
	 * property the page has changed since is left as it is.
	 *
	 * @deprecated Removes what `applyToDocument()` wrote. With `adopt()`, use `unadopt()`. To be
	 * removed in a later release.
	 */
	removeFromDocument(): void {
		const applied = this.appliedInline;
		if (applied === null) return;
		this.appliedInline = null;

		for (const [varName, { written, previous }] of applied.properties) {
			if (applied.root.style.getPropertyValue(varName) !== written) continue;
			if (previous.value === '') applied.root.style.removeProperty(varName);
			else applied.root.style.setProperty(varName, previous.value, previous.priority);
		}
	}

	/**
	 * Switch to a different node (e.g., theme switch).
	 *
	 * A runtime created with a `source` takes the new node's tokens as
	 * `source`; it may be omitted only to reapply the node it already holds.
	 * An HTTP runtime refuses a source.
	 */
	async switchNode(nodeId: string, source?: VioletTokenSource): Promise<Token[]> {
		// Checked before anything starts, so a refused switch supersedes nothing.
		const preloaded = this.nextSource(nodeId, source);

		await this.init();

		const generation = ++this.generation;
		const previousNodeId = this.currentNodeId;

		// Resolve first: if this fails (network, API error) nothing has changed -
		// the previous theme stays applied and currentNodeId is untouched.
		const { tokens, fromCache } = preloaded
			? { tokens: [...preloaded], fromCache: false }
			: await this.resolveTokens(nodeId);

		// A newer load()/switchNode() has started: this result is stale.
		if (generation !== this.generation) return tokens;

		// Commit: remove old tokens, then apply the new ones.
		this.removeFromDocument();
		this.currentNodeId = nodeId;
		if (preloaded) this.source = preloaded;
		this.setTokens(tokens);
		if (!fromCache) {
			this.emit('load', { tokens });
		}

		this.applyLoaded();

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
	 * Preload tokens for a node without applying. Nothing to do with a
	 * preloaded source: its tokens are already in memory.
	 */
	async preload(nodeId: string): Promise<void> {
		if (this.source) return;
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
	 * The validated tokens a switch to `nodeId` applies from memory, or null
	 * when this runtime loads over HTTP. Throws when the call does not fit the
	 * runtime's token origin.
	 */
	private nextSource(nodeId: string, source: VioletTokenSource | undefined): Token[] | null {
		if (this.source === null) {
			if (source !== undefined) {
				throw new Error(
					'VioletRuntime: switchNode was given a source, but this runtime loads over HTTP. Create the runtime with { nodeId, source } to apply preloaded tokens, or call switchNode(nodeId) without one.',
				);
			}
			return null;
		}
		if (source !== undefined) return sourceTokens(source, nodeId);
		if (nodeId === this.currentNodeId) return this.source;
		throw new Error(
			`VioletRuntime: switchNode("${nodeId}") needs a source, because this runtime applies preloaded tokens and holds none for "${nodeId}". Call switchNode("${nodeId}", { tokens }).`,
		);
	}

	/**
	 * After a load or switch: rewrite the adopted sheets, or apply inline when never adopted. A
	 * sheet that cannot be written is logged and dropped, so it does not stop the others, and its
	 * document's next `adopt()` makes a new one.
	 */
	private applyLoaded(): void {
		const preset = this.adoptedPreset;
		if (preset !== undefined) {
			for (const ref of this.sheetRefs) {
				const sheet = ref.deref();
				if (sheet === undefined) {
					this.sheetRefs.delete(ref);
					continue;
				}
				try {
					this.writeSheet(sheet, preset);
				} catch (error) {
					console.error(
						'VioletRuntime: an adopted sheet could not be rewritten and is no longer updated',
						error,
					);
					this.sheetRefs.delete(ref);
					const ownerDocument = this.sheetDocuments.get(sheet);
					if (ownerDocument !== undefined && this.sheets.get(ownerDocument) === sheet) {
						this.sheets.delete(ownerDocument);
					}
				}
			}
		} else if (this.config.autoApply) {
			this.applyToDocument();
		}
	}

	/** Drop the references to sheets that have been collected. */
	private pruneSheetRefs(): void {
		for (const ref of this.sheetRefs) {
			if (ref.deref() === undefined) this.sheetRefs.delete(ref);
		}
	}

	/**
	 * Write the loaded tokens into `sheet` as one rule, selected as `preset` (null for the
	 * default). Each value goes through the CSSOM's `setProperty`, as `applyToDocument()` writes
	 * it, never into stylesheet text, so a value cannot end the rule.
	 */
	private writeSheet(sheet: CSSStyleSheet, preset: string | null): void {
		// The selector is fixed once adopt() has run, so the rule is made once and its
		// declarations replaced after that.
		if (sheet.cssRules.length !== 1) {
			sheet.replaceSync(`${themeSelector(preset)} {}`);
		}
		const rule = sheet.cssRules[0] as CSSStyleRule;
		rule.style.cssText = '';
		const prefix = this.config.cssPrefix;
		for (const token of this.tokens.values()) {
			if (typeof token.value === 'string' || typeof token.value === 'number') {
				rule.style.setProperty(tokenCustomProperty(token.id, prefix), String(token.value));
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCache } from '../cache.js';
import { VioletRuntime } from '../client.js';
import { ThemeManager } from '../theme.js';
import type { RuntimeEventData, SourceToken, VioletConfig, VioletTokenSource } from '../types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const DARK: SourceToken[] = [
	{ id: 'color.surface', value: '#121212' },
	{ id: 'color.text', value: '#ffffff' },
	{ id: 'spacing.md', value: 12 },
];
const LIGHT: SourceToken[] = [
	{ id: 'color.surface', value: '#ffffff' },
	{ id: 'color.text', value: '#000000', resolvedAt: 'loam/base' },
];

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

function record(runtime: VioletRuntime): string[] {
	const events: string[] = [];
	for (const type of [
		'load',
		'load:error',
		'theme:change',
		'cache:hit',
		'cache:miss',
		'cache:update',
	] as const) {
		runtime.on(type, (event: RuntimeEventData) => events.push(event.type));
	}
	return events;
}

describe('VioletRuntime with a preloaded source', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('constructor', () => {
		it('refuses a source together with apiUrl or apiKey', () => {
			for (const http of [{ apiUrl: 'https://violet.example.com' }, { apiKey: 'secret' }]) {
				const config = { nodeId: 'loam/dark', source: { tokens: DARK }, ...http };
				expect(() => new VioletRuntime(config as unknown as VioletConfig)).toThrow(
					/either source or apiUrl\/apiKey, not both/,
				);
			}
		});

		it('refuses a source that is not { tokens: Token[] }', () => {
			for (const source of [null, {}, { tokens: 'nope' }]) {
				expect(
					() =>
						new VioletRuntime({
							nodeId: 'loam/dark',
							source: source as unknown as VioletTokenSource,
						}),
				).toThrow(/source for "loam\/dark" must be \{ tokens: Token\[\] \}/);
			}
		});

		it('refuses a token without a string id or with an unusable value', () => {
			const bad = [null, { value: '#fff' }, { id: '', value: '#fff' }, { id: 'a', value: null }];
			for (const token of bad) {
				const source = { tokens: [DARK[0], token] } as unknown as VioletTokenSource;
				expect(() => new VioletRuntime({ nodeId: 'loam/dark', source })).toThrow(
					/token 1 in the source for "loam\/dark"/,
				);
			}
		});
	});

	describe('load()', () => {
		it('applies the source with no request and no cache', async () => {
			const cacheInit = vi.spyOn(TokenCache.prototype, 'init');
			const cacheGet = vi.spyOn(TokenCache.prototype, 'get');
			const cacheSet = vi.spyOn(TokenCache.prototype, 'set');
			// cacheEnabled is ignored: a cached copy could only shadow the source.
			const runtime = new VioletRuntime({
				nodeId: 'loam/dark',
				source: { tokens: DARK },
				cacheEnabled: true,
			});
			const events = record(runtime);

			const tokens = await runtime.load();

			expect(mockFetch).not.toHaveBeenCalled();
			expect(cacheInit).not.toHaveBeenCalled();
			expect(cacheGet).not.toHaveBeenCalled();
			expect(cacheSet).not.toHaveBeenCalled();
			expect(events).toEqual(['load']);
			expect(tokens).toHaveLength(3);
			expect(cssVar('--color-surface')).toBe('#121212');
			expect(cssVar('--color-text')).toBe('#ffffff');
			expect(cssVar('--spacing-md')).toBe('12');
		});

		it('records tokens without resolvedAt as resolved at the node, keeping the rest', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/light', source: { tokens: LIGHT } });
			await runtime.load();

			expect(runtime.get('color.surface')).toEqual({
				id: 'color.surface',
				value: '#ffffff',
				resolvedAt: 'loam/light',
			});
			expect(runtime.get('color.text')?.resolvedAt).toBe('loam/base');
		});

		it('copies the source, so later changes to the caller array do not apply', async () => {
			const tokens: SourceToken[] = [{ id: 'color.text', value: '#ffffff' }];
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens } });
			tokens.push({ id: 'color.extra', value: 'red' });
			tokens[0] = { id: 'color.text', value: 'red' };

			const loaded = await runtime.load();
			loaded.pop();

			expect(runtime.getAll()).toEqual([
				{ id: 'color.text', value: '#ffffff', resolvedAt: 'loam/dark' },
			]);
			expect(await runtime.load()).toHaveLength(1);
		});

		it('honors autoApply and cssPrefix', async () => {
			const runtime = new VioletRuntime({
				nodeId: 'loam/dark',
				source: { tokens: DARK },
				autoApply: false,
				cssPrefix: 'loam',
			});
			await runtime.load();
			expect(cssVar('--loam-color-text')).toBe('');

			runtime.applyToDocument();
			expect(cssVar('--loam-color-text')).toBe('#ffffff');
			expect(runtime.getByPattern('color.*')).toHaveLength(2);
		});
	});

	describe('switchNode()', () => {
		it('applies the new source in place of the old one and emits theme:change', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });
			await runtime.load();
			const changes: unknown[] = [];
			runtime.on('theme:change', (event) => changes.push(event.data));

			const tokens = await runtime.switchNode('loam/light', { tokens: LIGHT });

			expect(mockFetch).not.toHaveBeenCalled();
			expect(runtime.getCurrentNodeId()).toBe('loam/light');
			expect(tokens.map((token) => token.id)).toEqual(['color.surface', 'color.text']);
			expect(cssVar('--color-surface')).toBe('#ffffff');
			expect(cssVar('--color-text')).toBe('#000000');
			// The old node's token the new source lacks is removed from the document.
			expect(cssVar('--spacing-md')).toBe('');
			expect(changes).toEqual([expect.objectContaining({ from: 'loam/dark', to: 'loam/light' })]);

			// load() now resolves from the new source.
			document.documentElement.removeAttribute('style');
			await runtime.load();
			expect(cssVar('--color-surface')).toBe('#ffffff');
		});

		it('reapplies the node it holds without a new source', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });

			await expect(runtime.switchNode('loam/dark')).resolves.toHaveLength(3);
			expect(cssVar('--color-text')).toBe('#ffffff');
		});

		it('refuses another node without a source and leaves the theme in place', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });
			await runtime.load();

			await expect(runtime.switchNode('loam/light')).rejects.toThrow(
				/switchNode\("loam\/light"\) needs a source/,
			);
			expect(runtime.getCurrentNodeId()).toBe('loam/dark');
			expect(cssVar('--color-text')).toBe('#ffffff');
		});

		it('refuses a malformed source and leaves the theme in place', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });
			await runtime.load();

			await expect(
				runtime.switchNode('loam/light', { tokens: [{ id: 'x' }] } as unknown as VioletTokenSource),
			).rejects.toThrow(/token 0 in the source for "loam\/light"/);
			expect(runtime.getCurrentNodeId()).toBe('loam/dark');
			expect(runtime.getAll()).toHaveLength(3);
		});

		it('a refused switch does not supersede one in flight', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });

			const pending = runtime.switchNode('loam/light', { tokens: LIGHT });
			await expect(runtime.switchNode('loam/hc')).rejects.toThrow(/needs a source/);
			await pending;

			expect(runtime.getCurrentNodeId()).toBe('loam/light');
			expect(cssVar('--color-surface')).toBe('#ffffff');
		});

		it('an HTTP runtime refuses a source and makes no request', async () => {
			const runtime = new VioletRuntime({ nodeId: 'brand', cacheEnabled: false });

			await expect(runtime.switchNode('brand-dark', { tokens: DARK })).rejects.toThrow(
				/this runtime loads over HTTP/,
			);
			expect(mockFetch).not.toHaveBeenCalled();
			expect(runtime.getCurrentNodeId()).toBe('brand');
		});
	});

	it('preload() has nothing to fetch', async () => {
		const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });

		await expect(runtime.preload('loam/light')).resolves.toBeUndefined();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	describe('with ThemeManager', () => {
		const themes = [
			{ nodeId: 'loam/dark', name: 'Dark', source: { tokens: DARK } },
			{ nodeId: 'loam/light', name: 'Light', source: { tokens: LIGHT } },
		];

		it('switches with each theme source, and preloads without a request', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });
			const manager = new ThemeManager(runtime, {
				themes,
				defaultTheme: 'loam/dark',
				transitionDuration: 0,
			});

			await manager.apply('loam/dark');
			expect(cssVar('--color-surface')).toBe('#121212');

			await manager.preloadAll();
			await manager.toggle('loam/dark', 'loam/light');
			expect(runtime.getCurrentNodeId()).toBe('loam/light');
			expect(cssVar('--color-surface')).toBe('#ffffff');

			await manager.apply('loam/dark');
			expect(cssVar('--color-surface')).toBe('#121212');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('passes no source for a theme without one', async () => {
			const runtime = new VioletRuntime({ nodeId: 'loam/dark', source: { tokens: DARK } });
			const switchNode = vi.spyOn(runtime, 'switchNode');
			const manager = new ThemeManager(runtime, {
				themes: [...themes, { nodeId: 'loam/other', name: 'Other' }],
				defaultTheme: 'loam/dark',
				transitionDuration: 0,
			});

			await expect(manager.switch('loam/other')).rejects.toThrow(/needs a source/);
			expect(switchNode).toHaveBeenCalledWith('loam/other');
			expect(manager.getCurrentTheme()?.nodeId).toBe('loam/dark');
		});
	});
});

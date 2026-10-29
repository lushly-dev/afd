import { describe, expect, it } from 'vitest';
import type { ResolvedToken } from '../../types/token.js';
import { luaTransformer } from './lua.js';

const token = (id: string, value: string | number): ResolvedToken => ({
	id,
	value,
	resolvedValue: value,
	metadata: { category: 'custom', tier: 'semantic', status: 'stable', platforms: [], tags: [] },
	resolvedAt: 'test',
	inheritanceChain: ['test'],
});

const tokens = [
	token('color.surface.canvas', '#1A1612'),
	token('color.focus-ring', '#FFD70080'),
	token('color.overlay', 'rgba(0, 0, 0, 0.5)'),
	token('color.short', '#fff8'),
	token('spacing.sm', '8px'),
	token('spacing.end', 4),
	token('font.family', 'Say "hi"'),
];

describe('lua transformer', () => {
	it('emits colors as { r, g, b, a } in 0-1 with prefixed camelCase names', () => {
		const lua = luaTransformer.transform(tokens, { prefix: 'vintageDark' });

		expect(lua).toContain(
			'vintageDarkSurfaceCanvas = { 0.102, 0.086, 0.071, 1 }, -- #1A1612 color.surface.canvas',
		);
		expect(lua).toContain('vintageDarkFocusRing = { 1, 0.843, 0, 0.502 },');
		expect(lua).toContain('vintageDarkOverlay = { 0, 0, 0, 0.5 },');
		expect(lua).toContain('vintageDarkShort = { 1, 1, 1, 0.533 },');
	});

	it('nests non-color tokens and quotes keywords and strings', () => {
		const lua = luaTransformer.transform(tokens);

		expect(lua).toContain('\tfont = {\n\t\tfamily = "Say \\"hi\\"",');
		expect(lua).toContain('["end"] = 4,');
		expect(lua).toContain('sm = "8px",');
		expect(lua).not.toContain('spacingSm');
	});

	it('emits a FenUI theme config from themeMap', () => {
		const lua = luaTransformer.transform(tokens, {
			prefix: 'vintageDark',
			className: 'VintageDark',
			themeMap: { surfacePanel: 'color.surface.canvas', borderFocus: 'color.focus-ring' },
		});

		expect(lua).toContain('local VintageDark = {}');
		expect(lua).toContain('VintageDark.theme = {\n\tname = "VintageDark",\n\ttokens = {');
		expect(lua).toContain('surfacePanel = "vintageDarkSurfaceCanvas",');
		expect(lua).toContain('borderFocus = "vintageDarkFocusRing",');
		expect(lua).toContain('return VintageDark');
	});

	it('omits the theme block without themeMap', () => {
		expect(luaTransformer.transform(tokens)).not.toContain('.theme = {');
	});

	it('throws when themeMap names a token that is not a color', () => {
		expect(() =>
			luaTransformer.transform(tokens, { themeMap: { textDefault: 'spacing.sm' } }),
		).toThrow(/not a color token/);
	});

	it('rejects module names that are not Lua identifiers', () => {
		expect(() => luaTransformer.transform(tokens, { className: 'end' })).toThrow();
		expect(() => luaTransformer.transform(tokens, { className: 'My-Tokens' })).toThrow();
	});
});

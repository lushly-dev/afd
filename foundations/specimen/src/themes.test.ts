import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { declaredThemesOf, type PackCase } from './pack-build.js';
import { changedShare, decodePng } from './png.js';
import { declaredThemes } from './stories.js';
import { type ThemeFrame, themeReport, themesSummary } from './themes.js';
import type { SpecimenEntry, SpecimenTheme } from './types.js';
import { parseConfig, parseThemesRequest } from './validate.js';

/** A PNG of `rows`, each row's bytes already in the colour type's layout, with one filter for all. */
function png(
	width: number,
	height: number,
	type: number,
	rows: number[][],
	filter = 0,
	extra: [string, number[]][] = []
): Uint8Array {
	const chunk = (kind: string, body: Uint8Array) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(body.length);
		head.write(kind, 4, 'latin1');
		// The decoder does not check the CRC, so it is left as zeros.
		return Buffer.concat([head, body, Buffer.alloc(4)]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = type;
	const raw = Buffer.concat(rows.map((row) => Buffer.from([filter, ...row])));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		...extra.map(([kind, body]) => chunk(kind, Buffer.from(body))),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

describe('PNG frames', () => {
	it('decodes RGB, RGBA, greyscale and palette images to RGBA', () => {
		expect(decodePng(png(2, 1, 2, [[1, 2, 3, 4, 5, 6]])).data).toEqual(
			new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255])
		);
		expect(decodePng(png(1, 1, 6, [[1, 2, 3, 4]])).data).toEqual(new Uint8Array([1, 2, 3, 4]));
		expect(decodePng(png(1, 1, 0, [[9]])).data).toEqual(new Uint8Array([9, 9, 9, 255]));
		expect(decodePng(png(1, 1, 4, [[9, 7]])).data).toEqual(new Uint8Array([9, 9, 9, 7]));
		const palette = png(1, 1, 3, [[1]], 0, [
			['PLTE', [0, 0, 0, 10, 20, 30]],
			['tRNS', [255, 128]],
		]);
		expect(decodePng(palette).data).toEqual(new Uint8Array([10, 20, 30, 128]));
	});

	it('undoes each row filter', () => {
		// Every filter over the same two greyscale rows, [10, 20] then [30, 50], encoded by hand.
		const expected = new Uint8Array([
			10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 50, 50, 50, 255,
		]);
		const cases: [number, number[][]][] = [
			[
				0,
				[
					[10, 20],
					[30, 50],
				],
			],
			[
				1,
				[
					[10, 10],
					[30, 20],
				],
			],
			[
				2,
				[
					[10, 20],
					[20, 30],
				],
			],
			// Average: the left byte and the byte above, halved and rounded down.
			[
				3,
				[
					[10, 15],
					[25, 25],
				],
			],
			// Paeth: of left, above and the corner, the one nearest left + above - corner.
			[
				4,
				[
					[10, 10],
					[20, 20],
				],
			],
		];
		for (const [filter, rows] of cases)
			expect(decodePng(png(2, 2, 0, rows, filter)).data, `filter ${filter}`).toEqual(expected);
	});

	it('refuses what it cannot read', () => {
		expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('Not a PNG');
		const sixteen = png(1, 1, 0, [[0, 0]]);
		sixteen[24] = 16;
		expect(() => decodePng(sixteen)).toThrow('bit depth 16');
		expect(() => decodePng(png(1, 1, 0, [[1]], 7))).toThrow('unknown filter');
		expect(() => decodePng(png(1, 1, 3, [[4]], 0, [['PLTE', [0, 0, 0]]]))).toThrow('palette');
	});

	it('counts the share of pixels that differ, and a different size as all of them', () => {
		const a = decodePng(
			png(2, 2, 0, [
				[1, 2],
				[3, 4],
			])
		);
		const b = decodePng(
			png(2, 2, 0, [
				[1, 2],
				[3, 5],
			])
		);
		expect(changedShare(a, a)).toBe(0);
		expect(changedShare(a, b)).toBe(0.25);
		expect(changedShare(a, decodePng(png(1, 1, 0, [[1]])))).toBe(1);
	});
});

const entry = (themes?: SpecimenEntry['themes']): SpecimenEntry => ({
	id: 'auth--sign-in',
	title: 'Auth/Sign in',
	module: './sign-in.stories.ts',
	exportName: 'Page',
	component: 'x-sign-in',
	...(themes ? { themes } : {}),
});
const frames = (
	themes: SpecimenTheme[],
	rendered: (theme: SpecimenTheme) => SpecimenTheme = (theme) => theme
): ThemeFrame[] => themes.map((theme) => ({ theme, rendered: rendered(theme) }));
const all: SpecimenTheme[] = ['light', 'dark', 'high-contrast'];
/** Frames that look alike when they are in the same group. */
const looks =
	(groups: number[]) =>
	(a: number, b: number): number =>
		groups[a] === groups[b] ? 0 : 0.4;

describe('theme reports', () => {
	it('reads a story’s declaration from its tags', () => {
		expect(declaredThemes(['dev', 'test'])).toBeUndefined();
		expect(declaredThemes(['light-only'])).toEqual({ supported: ['light'], basis: 'declared' });
		expect(declaredThemes(['high-contrast-only', 'autodocs', 'light-only'])).toEqual({
			supported: ['light', 'high-contrast'],
			basis: 'declared',
		});
	});

	it('flags a frame that stays the same with nothing declaring it', () => {
		const report = themeReport(entry(), frames(all), looks([0, 0, 0]), 0.02);
		expect(report).toMatchObject({ status: 'undeclared', declared: null, component: 'x-sign-in' });
		expect(report.frames.map((frame) => frame.changed)).toEqual([0, 0, 0]);
		// At the threshold still counts as the same; over it does not.
		expect(themeReport(entry(), frames(all), () => 0.02, 0.02).status).toBe('undeclared');
		expect(themeReport(entry(), frames(all), () => 0.021, 0.02).status).toBe('follows');
	});

	it('accepts the same frame when the entry declares its themes', () => {
		const light = { supported: ['light' as const], basis: 'declared' as const };
		expect(themeReport(entry(light), frames(all), looks([0, 0, 0]), 0.02).status).toBe('declared');
		// Light and high contrast both supported, and different; dark looks like light.
		const two = {
			supported: ['light' as const, 'high-contrast' as const],
			basis: 'declared' as const,
		};
		expect(themeReport(entry(two), frames(all), looks([0, 0, 1]), 0.02).status).toBe('declared');
		// Dark first: what it is compared with is a supported frame, wherever that is.
		expect(
			themeReport(entry(two), frames(['dark', 'high-contrast', 'light']), looks([0, 1, 0]), 0.02)
				.status
		).toBe('declared');
		// Only unsupported themes compared: they must at least agree with each other.
		expect(
			themeReport(entry(light), frames(['dark', 'high-contrast']), looks([0, 0]), 0.02).status
		).toBe('declared');
	});

	it('calls a declaration that the frames disprove contradicted', () => {
		const light = { supported: ['light' as const], basis: 'declared' as const };
		expect(themeReport(entry(light), frames(all), looks([0, 1, 0]), 0.02).status).toBe(
			'contradicted'
		);
		// A declaration of every compared theme sets no limit, so it follows like any other, and a
		// frame that stays the same is what the author declared.
		const every = { supported: all, basis: 'declared' as const };
		expect(themeReport(entry(every), frames(all), looks([0, 1, 2]), 0.02).status).toBe('follows');
		expect(themeReport(entry(every), frames(all), looks([0, 0, 0]), 0.02).status).toBe('declared');
	});

	it('counts a story that sets its own theme global as pinned', () => {
		const report = themeReport(
			entry(),
			frames(all, () => 'dark'),
			looks([0, 0, 0]),
			0.02
		);
		expect(report.status).toBe('pinned');
		expect(report.frames.map((frame) => frame.rendered)).toEqual(['dark', 'dark', 'dark']);
		// No theme reported is no evidence of a pin.
		expect(
			themeReport(
				entry(),
				frames(all, () => null as never),
				looks([0, 0, 0]),
				0.02
			).status
		).toBe('undeclared');
	});

	it('reports a theme that did not render, and compares nothing', () => {
		const failed: ThemeFrame[] = [
			{ theme: 'light', rendered: 'light' },
			{ theme: 'dark', rendered: null, reason: 'timed out' },
		];
		const report = themeReport(
			entry(),
			failed,
			() => {
				throw new Error('not called');
			},
			0.02
		);
		expect(report).toMatchObject({ status: 'unavailable', reason: 'dark: timed out' });
		expect(report.frames).toEqual([
			{ theme: 'light', rendered: 'light', changed: null },
			{ theme: 'dark', rendered: null, changed: null, reason: 'timed out' },
		]);
	});

	it('is valid only when no entry is undeclared', () => {
		const follows = themeReport(entry(), frames(all), looks([0, 1, 2]), 0.02);
		const same = themeReport(entry(), frames(all), looks([0, 0, 0]), 0.02);
		expect(themesSummary([follows])).toMatchObject({
			valid: true,
			counts: { total: 1, follows: 1, undeclared: 0 },
		});
		expect(themesSummary([follows, same])).toMatchObject({
			valid: false,
			counts: { total: 2, follows: 1, undeclared: 1 },
		});
	});
});

describe('theme declarations and requests', () => {
	const specimen = { id: 'a', title: 'A', module: './a.ts', exportName: 'A' };
	it('reads a native specimen’s themes, in theme order', () => {
		const config = parseConfig({
			specimens: [
				{
					...specimen,
					themes: { supported: ['high-contrast', 'light'], reason: 'matches the marketing site' },
				},
			],
		});
		expect(config.specimens?.[0]?.themes).toEqual({
			supported: ['light', 'high-contrast'],
			basis: 'declared',
			reason: 'matches the marketing site',
		});
		for (const themes of [
			{ supported: [] },
			{ supported: ['light', 'light'] },
			{ supported: ['sepia'] },
			{ supported: ['light'], basis: 'declared' },
			{ supported: ['light'], reason: '' },
			['light'],
		])
			expect(() => parseConfig({ specimens: [{ ...specimen, themes }] })).toThrow('themes');
	});

	it('parses a themes request', () => {
		expect(
			parseThemesRequest({
				filter: { tags: ['auth'] },
				themes: ['light', 'dark'],
				threshold: 0,
				context: { viewport: { width: 1280, height: 720 } },
				checkpoint: 'mount',
				timeoutMs: 5000,
				workers: 2,
			})
		).toEqual({
			filter: { tags: ['auth'] },
			themes: ['light', 'dark'],
			threshold: 0,
			context: { viewport: { width: 1280, height: 720 } },
			checkpoint: 'mount',
			timeoutMs: 5000,
			workers: 2,
		});
		for (const value of [
			{ id: 'a', filter: {} },
			{ themes: ['light'] },
			{ themes: ['light', 'light'] },
			{ themes: ['light', 'sepia'] },
			{ themes: 'light,dark' },
			{ threshold: 1.5 },
			{ threshold: Number.NaN },
			{ threshold: '0.1' },
			{ workers: 0 },
			{ other: 1 },
		])
			expect(() => parseThemesRequest(value), JSON.stringify(value)).toThrow('themes request');
	});
});

describe('declared themes in a built pack record', () => {
	const about = (themes?: SpecimenEntry['themes'], component = 'x-sign-in') =>
		({ id: 'case', component, themes, observation: {} }) as unknown as PackCase;
	const light = (reason?: string) => ({
		supported: ['light' as const, 'high-contrast' as const],
		basis: 'declared' as const,
		...(reason ? { reason } : {}),
	});

	it('declares a component’s themes when every case about it declares the same, in name order', () => {
		expect(declaredThemesOf('x-sign-in', [about(light('Brand.')), about(light('Brand.'))])).toEqual(
			{
				supported: ['high-contrast', 'light'],
				reason: 'Brand.',
			}
		);
		// Two reasons, or one case without one: no reason, the themes still declared.
		expect(declaredThemesOf('x-sign-in', [about(light('A.')), about(light('B.'))])).toEqual({
			supported: ['high-contrast', 'light'],
		});
		expect(declaredThemesOf('x-sign-in', [about(light('A.')), about(light())])).toEqual({
			supported: ['high-contrast', 'light'],
		});
		// Cases about another component do not count.
		expect(declaredThemesOf('x-sign-in', [about(light()), about(undefined, 'x-other')])).toEqual({
			supported: ['high-contrast', 'light'],
		});
	});

	it('declares nothing when a case follows the theme or the cases disagree', () => {
		expect(declaredThemesOf('x-sign-in', [])).toBeUndefined();
		expect(declaredThemesOf('x-sign-in', [about(light()), about()])).toBeUndefined();
		expect(declaredThemesOf('x-sign-in', [about(), about(light())])).toBeUndefined();
		// A Light and Dark pair, each pinning its preset: the component follows the theme.
		const dark = { supported: ['dark' as const], basis: 'declared' as const };
		const only = { supported: ['light' as const], basis: 'declared' as const };
		expect(declaredThemesOf('x-sign-in', [about(only), about(dark)])).toBeUndefined();
	});
});

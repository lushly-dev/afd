/**
 * Unit tests for `#hashHeard` path resolution (`settingsHashTarget`, #2098): proves that the shell's own `#<key>` URL
 * write triggers no duplicate `section-open` even when `hashchange` fires before `show()` updates `#shown`, while a
 * browser Back/hash navigation to another key (including a fast Back before `show()` catches up) opens that target and
 * discards stale reads if the URL changes mid-read.
 */
import type { KernelEventV3, LoamKernelV5 } from '@lushly-dev/loam-kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouterV1 } from '../router.js';
import { createUrlSync, type MainStateV1, type UrlHostV1 } from '../url-sync.js';
import { type SettingsSectionState, settingsHashTarget } from './hash-route.js';

vi.mock('./settings.js', () => ({ syncSettings: vi.fn(async () => {}) }));

const reported: unknown[] = [];
vi.stubGlobal('reportError', (error: unknown) => reported.push(error));
afterEach(() => {
	expect(reported.splice(0)).toEqual([]);
});

describe('settingsHashTarget (#2098)', () => {
	const ok =
		(state: Partial<SettingsSectionState> = {}) =>
		async () => ({
			success: true,
			data: { section: 'settings', path: 'loam.appearance/theme', active: null, ...state },
		});

	it('suppresses a duplicate section-open when section-get already holds the same route path', async () => {
		// Simulates hashchange firing right after url-sync writes `#density`, before `show()` updates `#shown`.
		const read = vi.fn(ok({ path: 'loam.appearance/density' }));
		expect(
			await settingsHashTarget(
				{ pathname: '/personal/~/settings/loam.appearance', hash: '#density' },
				'loam.appearance',
				read
			)
		).toBeUndefined();
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('resolves a fast Back to #theme even when show() still named theme while section-get holds density', async () => {
		const read = vi.fn(ok({ path: 'loam.appearance/density' }));
		expect(
			await settingsHashTarget(
				{ pathname: '/personal/~/settings/loam.appearance', hash: '#theme' },
				'loam.appearance',
				read
			)
		).toBe('loam.appearance.theme');
		expect(read).toHaveBeenCalledTimes(1);
	});

	it('discards a stale result when location changes while section-get is in flight', async () => {
		const loc = { pathname: '/personal/~/settings/loam.appearance', hash: '#theme' };
		let release!: () => void;
		const pending = settingsHashTarget(loc, 'loam.appearance', async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return {
				success: true,
				data: { section: 'settings', path: 'loam.appearance/density', active: null },
			};
		});
		// Forward navigation moves the fragment before section-get resolves.
		loc.hash = '#density';
		release();
		expect(await pending).toBeUndefined();
	});

	it('uses the pathname section over a stale selected section and ignores non-settings or empty hashes', async () => {
		expect(
			await settingsHashTarget(
				{ pathname: '/personal/~/settings/hello.general', hash: '#greeting' },
				'loam.appearance',
				ok({ path: 'hello.general/greeting' })
			)
		).toBeUndefined();
		expect(
			await settingsHashTarget(
				{ pathname: '/personal/~/settings/loam.appearance', hash: '' },
				'loam.appearance',
				ok()
			)
		).toBeUndefined();
		expect(
			await settingsHashTarget(
				{ pathname: '/personal/~/settings/loam.appearance', hash: '#density' },
				'loam.appearance',
				ok({ section: 'projects', path: '' })
			)
		).toBeUndefined();
	});

	it('journals exactly one section-open when url-sync writes a #key fragment', async () => {
		const journal: Array<{ name: string; input: Record<string, unknown> }> = [];
		let state: MainStateV1 = {
			scope: {},
			workspace: { id: 'personal' },
			project: null,
			section: 'settings',
			path: 'loam.appearance/theme',
			active: null,
		};
		const location = {
			origin: 'http://127.0.0.1:4173',
			protocol: 'http:',
			pathname: '/personal/~/settings/loam.appearance',
			hash: '#theme',
		};
		const pendingHash: Array<Promise<void>> = [];

		const kernel = {
			appsReady: Promise.resolve(),
			async call(name: string, input: Record<string, unknown> = {}) {
				if (name === 'section-get') {
					return {
						success: true,
						data: { section: state.section, path: state.path, active: state.active },
					};
				}
				if (name === 'section-open') {
					journal.push({ name, input });
					const target = input.target as string | undefined;
					const path = target
						? `${target.slice(0, target.lastIndexOf('.'))}/${target.slice(target.lastIndexOf('.') + 1)}`
						: ((input.path as string) ?? '');
					state = { ...state, section: input.section as string, path, active: null };
				}
				return { success: true, data: {} };
			},
		};

		const onHashChange = () => {
			pendingHash.push(
				(async () => {
					const target = await settingsHashTarget(
						location,
						'loam.appearance',
						() =>
							kernel.call('section-get') as Promise<{
								success: boolean;
								data?: SettingsSectionState;
							}>
					);
					if (target) await kernel.call('section-open', { section: 'settings', target });
				})()
			);
		};

		const host: UrlHostV1 = {
			kernel: kernel as unknown as LoamKernelV5,
			base: 'http://127.0.0.1:4173/',
			ownerDocument: {
				defaultView: {
					location,
					navigation: {
						navigate(url: string) {
							const parsed = new URL(url);
							const prevHash = location.hash;
							location.pathname = parsed.pathname;
							location.hash = parsed.hash;
							if (parsed.hash !== prevHash) onHashChange();
						},
					},
				},
			} as unknown as Document,
			router: {
				route: {
					kind: 'section',
					workspace: 'personal',
					section: 'settings',
					rest: ['loam.appearance'],
				},
				dispose() {},
			} as RouterV1,
			appList: [],
			readState: async () => structuredClone(state),
			route: 'home',
		};

		const sync = createUrlSync(host);
		await sync.boot();
		journal.length = 0;

		// Shell opens `#density`: url-sync rewrites location.hash and fires hashchange before `show()` updates.
		await kernel.call('section-open', { section: 'settings', target: 'loam.appearance.density' });
		sync.changed({
			command: 'section-open',
			interface: 'palette',
			success: true,
			mutation: true,
			mainChanged: 'push',
		} as KernelEventV3);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await Promise.all(pendingHash.splice(0));

		expect(location.hash).toBe('#density');
		expect(journal).toEqual([
			{ name: 'section-open', input: { section: 'settings', target: 'loam.appearance.density' } },
		]);

		// User clicks Back to `#theme`: one new `section-open` runs.
		location.hash = '#theme';
		onHashChange();
		await Promise.all(pendingHash.splice(0));

		expect(journal).toEqual([
			{ name: 'section-open', input: { section: 'settings', target: 'loam.appearance.density' } },
			{ name: 'section-open', input: { section: 'settings', target: 'loam.appearance.theme' } },
		]);
	});
});

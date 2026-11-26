import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	build,
	createServer,
	normalizePath,
	type Plugin,
	type Rolldown,
	type ViteDevServer,
} from 'vite';
import { inspectBuild, TOTAL_TRIPWIRE } from './build-waste.js';
import { listDesignCards, renderCardsPageHtml } from './cards.js';
import { renderComparePageHtml } from './compare-page.js';
import { bundled, defaultContext, type LoadedConfig } from './config.js';
import type { SpecimenHostError } from './host.js';
import { readReviewPageData } from './review.js';
import { renderReviewPageHtml } from './review-page.js';
import { assertRealFileContained, captureSetsDir, SET_ID_PATTERN } from './sets.js';
import type { SpecimenEntry } from './types.js';
import { isSafeStaticMount } from './validate.js';

/** Verify `target` stays inside `root` without following any symlink outside `root`. */
function isContained(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Verify no existing component along `dest` under `outRoot` is a symlink. */
async function assertNoSymlinkPath(outRoot: string, dest: string): Promise<void> {
	const rel = relative(outRoot, dest);
	if (!isContained(outRoot, dest))
		throw new Error(`Build write escapes the build output directory: ${dest}`);
	if (!rel) return;
	let current = outRoot;
	for (const part of rel.split(sep)) {
		if (!part) continue;
		current = join(current, part);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink())
				throw new Error(`Refusing to write through symbolic link inside build output: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw error;
		}
	}
}

/**
 * Copy a static directory into `outDir` under `to`, rejecting escaping symlinks and
 * materializing in-root symlinks so no symlink can redirect later writes out of `outDir`.
 */
export async function copyStaticTree(from: string, outDir: string, to: string): Promise<void> {
	const outRoot = await realpath(outDir);
	const fromRoot = await realpath(from);
	const destRoot = staticDestination(outRoot, to);
	if (isContained(fromRoot, destRoot) || isContained(destRoot, fromRoot))
		throw new Error(`staticDirs source and destination overlap: ${from} -> ${to}`);
	await assertNoSymlinkPath(outRoot, destRoot);
	await mkdir(destRoot, { recursive: true });
	const visited = new Set<string>([fromRoot]);

	async function copyDir(srcDir: string, dstDir: string): Promise<void> {
		const entries = await readdir(srcDir);
		for (const name of entries) {
			const src = join(srcDir, name);
			const dst = join(dstDir, name);
			await assertNoSymlinkPath(outRoot, dst);
			const entryStat = await lstat(src);
			if (entryStat.isSymbolicLink()) {
				const targetReal = await realpath(src);
				if (!isContained(fromRoot, targetReal))
					throw new Error(`staticDirs symlink escapes its source root: ${src}`);
				const targetStat = await stat(targetReal);
				if (targetStat.isDirectory()) {
					if (visited.has(targetReal)) throw new Error(`staticDirs symlink cycle detected: ${src}`);
					visited.add(targetReal);
					await mkdir(dst, { recursive: true });
					await copyDir(targetReal, dst);
					visited.delete(targetReal);
				} else if (targetStat.isFile()) {
					await copyFile(targetReal, dst);
				}
			} else if (entryStat.isDirectory()) {
				await mkdir(dst, { recursive: true });
				await copyDir(src, dst);
			} else if (entryStat.isFile()) {
				await copyFile(src, dst);
			}
		}
	}

	await copyDir(fromRoot, destRoot);
}

/** Resolve a static directory's copy destination and guarantee it stays within `outDir`. */
export function staticDestination(outDir: string, to: string): string {
	if (!isSafeStaticMount(to))
		throw new Error(`staticDirs mount path escapes the build output directory: ${to}`);
	const base = resolve(outDir);
	const trimmed = to.replace(/^\/+/, '');
	const target = resolve(base, trimmed);
	if (!isContained(base, target))
		throw new Error(`staticDirs mount path escapes the build output directory: ${to}`);
	return target;
}

const ENTRY = '/__specimen_entry__.js';
/** Every story's identity and loader: sized by the consumer, so never in the entry's chunk. */
const CATALOG = '\0specimen-catalog';
/**
 * The proposal's shell ceiling was 50,000. It moved to 52,000 in #1001 (49,793 bytes on the
 * fixtures), to 68,000 in #2042 (65,222 bytes on fixtures), and to 70,000 in #2037 after #2306's
 * portable gate validators and #2037's real-timer / lazy job-runtime hooks took the packed
 * native consumer shell to 68,248 bytes (67,790 on fixtures), restoring consumer-build margin.
 */
const SHELL_BUDGET = 70_000;
/** The index and preview pages' own stylesheet, in minified UTF-8 bytes; a story's CSS is its own. */
const STYLE_BUDGET = 8_000;
/**
 * The proposal's category ceilings, in minified UTF-8 JavaScript bytes, for the bench's own code.
 * #2037 moved interaction to 615,000 after the lazy `job-runtime`/`clock` chunk (4,420 bytes)
 * took compat interaction to 598,652 B on Windows / 600,210 B on Linux. The accessibility engine
 * and the total have no ceiling (#1072): axe-core is a dependency whose growth is reported, and
 * `build-waste.ts` fails what is waste instead, by a named cause, with a distant total tripwire.
 */
const CATEGORY_BUDGETS = {
	shell: SHELL_BUDGET,
	interaction: 615_000,
} as const;
/**
 * The helpers a play imports, with what they bring: the proposal's interaction support (Vitest
 * helpers, Testing Library, jest-dom), however a story imports them, never consumer code.
 */
const HELPERS = /\/node_modules\/(?:storybook\/dist\/test\/|@testing-library\/|@vitest\/|chai\/)/;
/** What else a retained preview or story imports from the framework it is leaving. */
const INCUMBENT = /\/node_modules\/(?:storybook|@storybook\/[^/]+)\//;
const html =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Specimens</title></head><body><main id="specimen-root"></main><script type="module" src="/__specimen_entry__.js"></script></body></html>';
async function runtimePath(): Promise<string> {
	const compiled = fileURLToPath(new URL('./browser/index.js', import.meta.url));
	try {
		await readFile(compiled);
		return compiled;
	} catch {
		return fileURLToPath(new URL('./browser/index.ts', import.meta.url));
	}
}
function catalogSource(config: LoadedConfig): string {
	const { entries, modules } = bundled(config);
	const loaders = Object.entries(modules)
		.map(([id, file]) => `${JSON.stringify(id)}: () => import(${JSON.stringify(file)})`)
		.join(',');
	return `export const entries = ${JSON.stringify(entries)};
export const loaders = {${loaders}};`;
}
function entrySource(runtime: string): string {
	return `import { installRuntime, installPage } from ${JSON.stringify(runtime)};
const { entries, loaders } = await import(${JSON.stringify('/__specimen_catalog__.js')});
installRuntime(loaders);
await installPage(entries, ${JSON.stringify(defaultContext)});`;
}
export interface BenchServer {
	url: string;
	server: ViteDevServer;
	close(): Promise<void>;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
}
/** The bench page and its virtual entry, shared by the dev server and both builds. */
export interface BenchSite {
	root: string;
	runtime: string;
	plugin: Plugin;
	build(
		outDir: string
	): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }>;
	dispose(): Promise<void>;
}

export async function prepareBenchSite(config: LoadedConfig): Promise<BenchSite> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'afd-specimen-')));
	const runtime = await runtimePath();
	await writeFile(join(root, 'index.html'), html);
	await writeFile(join(root, 'specimen.html'), html);
	const plugin: Plugin = {
		name: 'afd-specimen',
		// Before Vite's resolver, which would find the real `vitest/browser` first.
		enforce: 'pre',
		resolveId(id) {
			if (id === ENTRY) return '\0specimen-entry';
			if (id === '/__specimen_catalog__.js') return CATALOG;
			// A retained play's real keyboard; see `browser/vitest-browser.ts`.
			if (id === 'vitest/browser')
				return join(dirname(runtime), `vitest-browser${extname(runtime)}`);
		},
		load(id) {
			if (id === '\0specimen-entry') return entrySource(runtime);
			if (id === CATALOG) return catalogSource(config);
		},
	};
	return {
		root,
		runtime,
		plugin,
		build: (outDir) =>
			buildStatic(
				root,
				runtime,
				plugin,
				outDir,
				config.staticDirs,
				bundled(config).entries,
				config.root,
				// What every case loads: the plugins and a retained story's project annotations.
				[...config.plugins, ...(config.stories?.preview ? [config.stories.preview] : [])]
			),
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}

/**
 * Vite's dependency optimizer writes its bundle into `<root>/.vite/deps_temp_*`, and
 * `server.close()` can resolve while that write is still running: cancelling a run stops it only
 * before its write begins, and a run Vite stops tracking at the end of the import crawl is not
 * cancelled at all. Removing the root then fails with ENOTEMPTY, or the write recreates it after
 * removal. Each optimizer build gets its own tracker, from its start to the one hook that ends
 * it, so teardown removes the root once no write is running, and again after any later build.
 */
export function optimizerWrites(root: string): {
	plugin: Rolldown.Plugin;
	dispose(): Promise<void>;
} {
	let running = 0;
	let started = 0;
	let disposed = false;
	let idle: PromiseWithResolvers<void> | undefined;
	// One removal at a time, so a late build's cleanup never races teardown's.
	let removal: Promise<void> = Promise.resolve();
	const remove = () => {
		removal = removal.catch(() => undefined).then(() => rm(root, { recursive: true, force: true }));
		return removal;
	};
	const tracker = (): Rolldown.Plugin => {
		let state: 'pending' | 'running' | 'ended' = 'pending';
		const end = async () => {
			if (state !== 'running') return;
			state = 'ended';
			if (--running) return;
			if (idle) {
				idle.resolve();
				idle = undefined;
			} else if (disposed) {
				// A build that began after teardown removed the root: nobody awaits this, and
				// failing here would only fail Vite's own run, which is already discarded.
				await remove().catch(() => undefined);
			}
		};
		return {
			name: 'afd-specimen-optimizer-write',
			buildStart() {
				state = 'running';
				running++;
				started++;
			},
			// Exactly one of these ends a build; closeBundle covers a failed write.
			buildEnd: (error) => (error ? end() : undefined),
			renderError: end,
			writeBundle: end,
			closeBundle: end,
		};
	};
	return {
		plugin: {
			name: 'afd-specimen-optimizer-writes',
			// A fresh tracker per build: Rolldown's hooks do not say which build called them.
			options: (options) => ({ ...options, plugins: [options.plugins, tracker()] }),
		},
		async dispose() {
			disposed = true;
			for (;;) {
				if (running) {
					idle ??= Promise.withResolvers<void>();
					await idle.promise;
				}
				const before = started;
				try {
					await remove();
					return;
				} catch (error) {
					// Only a build that began during the removal may write into it; wait for it.
					if (started === before) throw error;
				}
			}
		},
	};
}

export async function startBenchServer(
	config: LoadedConfig,
	options: { automation?: boolean } = {}
): Promise<BenchServer> {
	const site = await prepareBenchSite(config);
	const { root, runtime, plugin } = site;
	const cachedDevMaps: Plugin = {
		name: 'afd-specimen-cached-dev-maps',
		apply: 'serve',
		enforce: 'post',
		async transform(code, id) {
			const file = id.split(/[?#]/, 1)[0];
			if (!file || !isAbsolute(file) || !/\.[cm]?js$/.test(file)) return null;
			// Vite can remove external map comments during load. Compare the original
			// file too, leaving existing maps and earlier code transforms untouched.
			if (/sourceMappingURL\s*=/.test(code)) return null;
			const original = await readFile(file, 'utf8').catch(() => null);
			if (original !== code) return null;
			const map = this.getCombinedSourcemap();
			if (map.sources.length !== 1 || map.sources[0] !== file || map.sourcesContent?.[0] !== code)
				return null;
			// Vite discards a transform's map when its code equals the loaded code.
			// One trailing newline preserves JS behavior (including terminal comments)
			// while making Vite retain this fallback map in its normal transform cache.
			return { code: `${code}\n`, map };
		},
	};
	const compareServe: Plugin = {
		name: 'afd-specimen-compare',
		apply: 'serve',
		configureServer(devServer) {
			const projectRoot = resolve(config.root);
			const setsRoot = captureSetsDir(projectRoot);
			devServer.middlewares.use((req, res, next) => {
				if (req.method !== 'GET' && req.method !== 'HEAD') return next();
				let pathname: string;
				try {
					pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
				} catch {
					res.statusCode = 400;
					res.end();
					return;
				}
				if (pathname === '/compare.html') {
					const body = renderComparePageHtml();
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(req.method === 'HEAD' ? undefined : body);
					return;
				}
				if (pathname === '/review.html') {
					const body = renderReviewPageHtml();
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(req.method === 'HEAD' ? undefined : body);
					return;
				}
				if (pathname === '/cards.html') {
					const body = renderCardsPageHtml();
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(req.method === 'HEAD' ? undefined : body);
					return;
				}
				if (pathname === '/api/cards.json') {
					const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
					const params = reqUrl.searchParams;
					const card = params.get('card')?.trim() || undefined;
					const scope = params.get('scope')?.trim() || undefined;
					const status = params.get('status')?.trim() || undefined;
					const severity = params.get('severity')?.trim() || undefined;
					const includeProvisional = params.get('includeProvisional') === 'true' ? true : undefined;
					const includeDecided = params.get('includeDecided') === 'true' ? true : undefined;
					const rawLimit = params.get('limit')?.trim();
					const limit = rawLimit ? Number(rawLimit) : undefined;
					const after = params.get('after')?.trim() || undefined;
					void (async () => {
						try {
							const data = await listDesignCards(projectRoot, {
								...(card ? { card } : {}),
								...(scope ? { scope: scope as 'all' | 'release' | 'guidance' | 'interface' } : {}),
								...(status
									? {
											status: status as
												| 'open'
												| 'deferred'
												| 'changes-requested'
												| 'withdrawn'
												| 'all',
										}
									: {}),
								...(severity ? { severity: severity as 'blocker' | 'major' | 'minor' } : {}),
								...(includeProvisional ? { includeProvisional } : {}),
								...(includeDecided ? { includeDecided } : {}),
								...(limit !== undefined ? { limit } : {}),
								...(after ? { after } : {}),
							});
							res.statusCode = 200;
							res.setHeader('Content-Type', 'application/json; charset=utf-8');
							res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
						} catch (error) {
							const hostError = error as SpecimenHostError;
							res.statusCode = hostError.code === 'CARD_NOT_FOUND' ? 404 : 400;
							res.setHeader('Content-Type', 'application/json; charset=utf-8');
							res.end(
								req.method === 'HEAD'
									? undefined
									: JSON.stringify({
											error: {
												code: hostError.code ?? 'DESIGN_CARD_LIST_FAILED',
												message:
													error instanceof Error ? error.message : 'Could not list decision cards.',
											},
										})
							);
						}
					})();
					return;
				}
				if (pathname === '/api/review.json') {
					const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
					const before = reqUrl.searchParams.get('before')?.trim() ?? '';
					const after = reqUrl.searchParams.get('after')?.trim() ?? '';
					const hasIdsParam = reqUrl.searchParams.has('ids');
					const idsRaw = reqUrl.searchParams.get('ids')?.trim() ?? '';
					const ids = hasIdsParam
						? idsRaw
								.split(',')
								.map((id) => id.trim())
								.filter(Boolean)
						: undefined;
					if (!before || !after || (hasIdsParam && (!ids || ids.length === 0))) {
						res.statusCode = 400;
						res.setHeader('Content-Type', 'application/json; charset=utf-8');
						res.end(
							req.method === 'HEAD'
								? undefined
								: JSON.stringify({
										error: {
											code: 'VALIDATION_ERROR',
											message:
												hasIdsParam && (!ids || ids.length === 0)
													? 'ids query parameter must contain at least one specimen id.'
													: 'Both before and after query parameters are required.',
										},
									})
						);
						return;
					}
					void (async () => {
						try {
							const data = await readReviewPageData(projectRoot, {
								before,
								after,
								...(ids?.length ? { ids } : {}),
							});
							res.statusCode = 200;
							res.setHeader('Content-Type', 'application/json; charset=utf-8');
							res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
						} catch (error) {
							const hostError = error as SpecimenHostError;
							res.statusCode = hostError.code === 'CAPTURE_SET_NOT_FOUND' ? 404 : 400;
							res.setHeader('Content-Type', 'application/json; charset=utf-8');
							res.end(
								req.method === 'HEAD'
									? undefined
									: JSON.stringify({
											error: {
												code: hostError.code ?? 'SPECIMEN_REVIEW_FAILED',
												message:
													error instanceof Error ? error.message : 'Could not compute review.',
												...(hostError.suggestion ? { suggestion: hostError.suggestion } : {}),
											},
										})
							);
						}
					})();
					return;
				}
				const isCompareAssetRoute =
					pathname.startsWith('/sets/') || pathname.startsWith('/.specimen/sets/');
				const touchesPrivateStore = /(?:^|\/)\.specimen(?:\/|$)/i.test(pathname);
				if (!isCompareAssetRoute) {
					if (touchesPrivateStore) {
						res.statusCode = 404;
						res.end();
						return;
					}
					return next();
				}
				const match =
					/^\/(?:\.specimen\/)?sets\/(set-[0-9a-f]{12})\/(compare\.json|screenshots\/[a-zA-Z0-9._-]+\.png)$/.exec(
						pathname
					);
				if (!match) {
					res.statusCode = 404;
					res.end();
					return;
				}
				const setId = match[1] as string;
				const subPath = match[2] as string;
				if (!SET_ID_PATTERN.test(setId)) {
					res.statusCode = 404;
					res.end();
					return;
				}
				const filePath = join(setsRoot, setId, subPath);
				void (async () => {
					try {
						await assertNoSymlinkPath(projectRoot, filePath);
						await assertRealFileContained(
							projectRoot,
							filePath,
							`Compare asset escapes project root: ${pathname}`
						);
						await assertRealFileContained(
							setsRoot,
							filePath,
							`Compare asset escapes capture sets: ${pathname}`
						);
						const data = await readFile(filePath);
						res.statusCode = 200;
						res.setHeader(
							'Content-Type',
							subPath.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8'
						);
						res.end(req.method === 'HEAD' ? undefined : data);
					} catch {
						res.statusCode = 404;
						res.end();
					}
				})();
			});
		},
	};
	const writes = optimizerWrites(root);
	const server = await createServer({
		configFile: false,
		root,
		plugins: [plugin, compareServe, cachedDevMaps],
		// The HTML references a virtual entry; scan its actual import roots before
		// dynamic specimen loading can discover dependencies and reload the page.
		optimizeDeps: {
			entries: [runtime, ...new Set(Object.values(bundled(config).modules))],
			rolldownOptions: { plugins: [writes.plugin] },
		},
		logLevel: 'silent',
		server: {
			host: '127.0.0.1',
			port: 0,
			// Captures must retain their document even if dependency discovery or a
			// source edit requests a reload. Interactive benches retain live updates.
			hmr: options.automation ? false : undefined,
			// The runtime's directory and its parent, which holds the lazily loaded normalizer.
			fs: {
				allow: [root, config.root, dirname(dirname(runtime))],
				deny: ['**/.specimen/**'],
			},
		},
	});
	try {
		await server.listen();
	} catch (error) {
		await server.close();
		await writes.dispose();
		throw error;
	}
	const address = server.httpServer?.address();
	if (!address || typeof address === 'string') {
		await server.close();
		await writes.dispose();
		throw new Error('Bench server did not bind a TCP port');
	}
	return {
		url: `http://127.0.0.1:${address.port}`,
		server,
		async close() {
			try {
				await server.close();
			} finally {
				// After the optimizer's last write, which can outlive `server.close()`.
				await writes.dispose();
			}
		},
		build: site.build,
	};
}

/**
 * Copy only safe viewer assets (`compare.json` and `screenshots/*.png`, never raw observations)
 * from existing compare sets under `<projectRoot>/.specimen/sets/` into `<outRoot>/sets/`.
 */
async function copyCompareAssets(projectRoot: string, outRoot: string): Promise<string[]> {
	const absProject = resolve(projectRoot);
	const setsRoot = captureSetsDir(absProject);
	try {
		await assertNoSymlinkPath(absProject, setsRoot);
		const info = await lstat(setsRoot);
		if (!info.isDirectory() || info.isSymbolicLink()) return [];
	} catch {
		return [];
	}
	const copied: string[] = [];
	const entries = await readdir(setsRoot).catch(() => [] as string[]);
	for (const setId of entries) {
		if (!SET_ID_PATTERN.test(setId)) continue;
		const srcSetDir = join(setsRoot, setId);
		const srcCompare = join(srcSetDir, 'compare.json');
		try {
			await assertNoSymlinkPath(absProject, srcCompare);
			await assertRealFileContained(absProject, srcCompare, 'Compare asset escapes project root');
			const info = await lstat(srcCompare);
			if (!info.isFile() || info.isSymbolicLink()) continue;
		} catch {
			continue;
		}
		const dstSetDir = join(outRoot, 'sets', setId);
		const dstCompare = join(dstSetDir, 'compare.json');
		await assertNoSymlinkPath(outRoot, dstCompare);
		await mkdir(dstSetDir, { recursive: true });
		await copyFile(srcCompare, dstCompare);
		copied.push(`sets/${setId}/compare.json`);

		const srcShotsDir = join(srcSetDir, 'screenshots');
		try {
			await assertNoSymlinkPath(absProject, srcShotsDir);
			const shotNames = await readdir(srcShotsDir);
			const dstShotsDir = join(dstSetDir, 'screenshots');
			for (const name of shotNames) {
				if (!/^[a-zA-Z0-9._-]+\.png$/.test(name)) continue;
				const srcShot = join(srcShotsDir, name);
				try {
					await assertNoSymlinkPath(absProject, srcShot);
					await assertRealFileContained(absProject, srcShot, 'Screenshot escapes project root');
					const shotStat = await lstat(srcShot);
					if (!shotStat.isFile() || shotStat.isSymbolicLink()) continue;
				} catch {
					continue;
				}
				const dstShot = join(dstShotsDir, name);
				await assertNoSymlinkPath(outRoot, dstShot);
				await mkdir(dstShotsDir, { recursive: true });
				await copyFile(srcShot, dstShot);
				copied.push(`sets/${setId}/screenshots/${name}`);
			}
		} catch {
			// Compare sets without screenshots still copy compare.json.
		}
	}
	return copied;
}

async function buildStatic(
	root: string,
	runtime: string,
	plugin: Plugin,
	outDir: string,
	staticDirs: LoadedConfig['staticDirs'],
	entries: SpecimenEntry[],
	projectRoot: string,
	alwaysLoaded: readonly string[]
): Promise<{ directory: string; shellBytes: number; budget: number; files: string[] }> {
	const directory = resolve(outDir);
	await mkdir(directory, { recursive: true });
	// Specimen's own helpers go with the others, whoever imports them, and so does all they bring.
	const nativeHelper = /^(?:test|evidence)\.[cm]?[jt]s$/;
	// Module ids are Vite's, `/`-separated on every system; the runtime's path is the system's.
	const runtimeId = normalizePath(runtime);
	const helperCode = new Set<string>();
	const isHelper = (id: string) => HELPERS.test(id) || helperCode.has(id);
	const helperAccounting: Plugin = {
		name: 'afd-specimen-helper-accounting',
		buildEnd() {
			const pending = [...this.getModuleIds()].filter(
				(id) => dirname(id) === dirname(dirname(runtimeId)) && nativeHelper.test(basename(id))
			);
			for (let id = pending.pop(); id; id = pending.pop()) {
				if (helperCode.has(id)) continue;
				helperCode.add(id);
				pending.push(...(this.getModuleInfo(id)?.importedIds ?? []));
			}
		},
	};
	if ((await readdir(directory)).length) throw new Error('Build output directory must be empty');
	const result = await build({
		configFile: false,
		root,
		plugins: [plugin, helperAccounting],
		logLevel: 'silent',
		mode: 'development',
		build: {
			outDir: directory,
			emptyOutDir: false,
			minify: true,
			manifest: true,
			rolldownOptions: {
				input: { index: join(root, 'index.html'), specimen: join(root, 'specimen.html') },
				// Their own chunks, so each is measured exactly and not as a share of a consumer's.
				output: {
					codeSplitting: {
						groups: [
							{ name: 'interaction-support', test: isHelper, priority: 2 },
							{ name: 'incumbent', test: INCUMBENT, priority: 1 },
						],
					},
				},
			},
		},
	});
	if (Array.isArray(result) || !('output' in result))
		throw new Error('Unexpected Vite build result');
	for (const { from, to } of staticDirs) await copyStaticTree(from, directory, to);
	const chunks = result.output.filter((output) => output.type === 'chunk');
	// The proposal's categories: the shell lists and mounts a plain fixture; retained stories'
	// runtime is interaction support and axe is the accessibility engine, each loaded only by
	// the cases that need them and each counted against its own budget, never left out.
	const runtimeDirectory = dirname(runtimeId);
	const lazyRuntime = [
		'story-runtime',
		'csf',
		'vitest-browser',
		'expectations',
		'clock',
		'clock-parse',
		'job-runtime',
	].map((name) => `${runtimeDirectory}/${name}`);
	const packageSource = dirname(runtimeDirectory);
	// What a consumer's preview imports is a line of the consumer's own preview, wherever it lands.
	const isBenchCode = (id: string) =>
		id.startsWith(packageSource) && !/^preview\.[cm]?[jt]s$/.test(basename(id));
	const categoryOf = (
		chunk: (typeof chunks)[number]
	): 'shell' | 'interaction' | 'accessibility' | 'catalog' | 'incumbent' | 'consumer' => {
		const ids = Object.keys(chunk.modules);
		if (ids.includes(CATALOG)) return 'catalog';
		if (ids.some(isHelper)) return 'interaction';
		if (ids.some((id) => INCUMBENT.test(id))) return 'incumbent';
		if (ids.some((id) => id.includes('/axe-core/'))) return 'accessibility';
		const owned = ids.filter((id) => id.startsWith(runtimeDirectory));
		if (owned.length && owned.every((id) => lazyRuntime.some((path) => id.startsWith(path))))
			return 'interaction';
		// Any other bench code is the shell's, however it loads, capture code included.
		return chunk.isEntry || ids.includes('\0specimen-entry') || ids.some(isBenchCode)
			? 'shell'
			: 'consumer';
	};
	const categories = new Map(chunks.map((chunk) => [chunk.fileName, categoryOf(chunk)]));
	const shell = new Set(
		chunks
			.filter((chunk) => categories.get(chunk.fileName) === 'shell')
			.map((chunk) => chunk.fileName)
	);
	let added = true;
	while (added) {
		added = false;
		for (const chunk of chunks)
			if (shell.has(chunk.fileName))
				for (const imported of chunk.imports)
					if (!shell.has(imported) && categories.get(imported) === 'consumer') {
						shell.add(imported);
						categories.set(imported, 'shell');
						added = true;
					}
	}
	const bytesOf = (category: string) =>
		chunks
			.filter((chunk) => categories.get(chunk.fileName) === category)
			.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
	const shellBytes = bytesOf('shell');
	const categoryBytes = {
		shell: shellBytes,
		interaction: bytesOf('interaction'),
		accessibility: bytesOf('accessibility'),
	};
	const total = Object.values(categoryBytes).reduce((sum, bytes) => sum + bytes, 0);
	const { modules, waste, advisories } = inspectBuild(
		chunks,
		(fileName) => categories.get(fileName) ?? 'consumer',
		{ packageSource, projectRoot, siteRoot: root, alwaysLoaded },
		total
	);
	const outRoot = await realpath(directory);
	const comparePath = join(outRoot, 'compare.html');
	await assertNoSymlinkPath(outRoot, comparePath);
	await writeFile(comparePath, renderComparePageHtml(), 'utf8');
	const reviewPath = join(outRoot, 'review.html');
	await assertNoSymlinkPath(outRoot, reviewPath);
	await writeFile(reviewPath, renderReviewPageHtml(), 'utf8');
	const cardsPath = join(outRoot, 'cards.html');
	await assertNoSymlinkPath(outRoot, cardsPath);
	await writeFile(cardsPath, renderCardsPageHtml(), 'utf8');
	const copiedCompareAssets = await copyCompareAssets(projectRoot, outRoot);
	const files = [
		...result.output.map((output) => output.fileName),
		'compare.html',
		'review.html',
		'cards.html',
		...copiedCompareAssets,
	];
	// Its emitted, minified file. A build without it would publish an unstyled index, so it fails.
	const stylesheet = join(dirname(runtime), 'page.css');
	const styles = result.output.find(
		(output) =>
			output.type === 'asset' &&
			output.originalFileNames.some((name) => resolve(root, name) === stylesheet)
	);
	if (styles?.type !== 'asset')
		throw new Error(`The bench pages' stylesheet was not emitted from ${stylesheet}`);
	const styleBytes = Buffer.byteLength(styles.source);
	const report = { directory, shellBytes, budget: SHELL_BUDGET, files };
	const reportPath = join(outRoot, 'specimen-build.json');
	await assertNoSymlinkPath(outRoot, reportPath);
	await writeFile(
		reportPath,
		JSON.stringify(
			{
				...report,
				// Each case's identity and link, for what reads the build without running it.
				entries: entries.map((entry) => ({
					...entry,
					url: `specimen.html?id=${encodeURIComponent(entry.id)}`,
				})),
				// A tripwire, not a budget: only an accident comes near it.
				total: { bytes: total, tripwire: TOTAL_TRIPWIRE },
				styles: { file: styles.fileName, bytes: styleBytes, budget: STYLE_BUDGET },
				categories: Object.fromEntries(
					Object.entries(categoryBytes).map(([category, bytes]) => {
						const budget = CATEGORY_BUDGETS[category as keyof typeof CATEGORY_BUDGETS];
						return [category, budget === undefined ? { bytes } : { bytes, budget }];
					})
				),
				// The proposal reports consumer code separately, with no core-wide ceiling.
				reported: {
					catalog: bytesOf('catalog'),
					incumbent: bytesOf('incumbent'),
					consumer: bytesOf('consumer'),
				},
				chunks: chunks.map((chunk) => ({
					file: chunk.fileName,
					category: categories.get(chunk.fileName),
					bytes: Buffer.byteLength(chunk.code),
				})),
				// Each module's rendered bytes, for `buildSizeDeltas` to compare with another build.
				modules,
				waste,
				advisories,
			},
			null,
			2
		)
	);
	if (shellBytes > SHELL_BUDGET)
		throw new Error(`Bench shell exceeds budget: ${shellBytes} > ${SHELL_BUDGET} bytes`);
	for (const [category, budget] of Object.entries(CATEGORY_BUDGETS)) {
		const bytes = categoryBytes[category as keyof typeof CATEGORY_BUDGETS];
		if (bytes > budget)
			throw new Error(`Bench ${category} code exceeds budget: ${bytes} > ${budget} bytes`);
	}
	if (styleBytes > STYLE_BUDGET)
		throw new Error(`Bench page styles exceed budget: ${styleBytes} > ${STYLE_BUDGET} bytes`);
	if (waste.length) throw new Error(`Bench build has waste:\n- ${waste.join('\n- ')}`);
	return report;
}

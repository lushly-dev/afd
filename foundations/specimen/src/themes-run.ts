import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { changedShare, decodePng, type Pixels } from './png.js';
import { pool, selectEntries } from './suite.js';
import {
	DEFAULT_THEME_CONTEXT,
	DEFAULT_THEME_THRESHOLD,
	type ThemeFrame,
	themeReport,
	themesSummary,
} from './themes.js';
import type {
	SpecimenContext,
	SpecimenEntry,
	SpecimenTheme,
	ThemesRequest,
	ThemesRun,
} from './types.js';
import { THEMES } from './validate.js';

/** What a themes run needs of the bench: its entries, and a render that writes a screenshot. */
export interface ThemesHost {
	entries: readonly SpecimenEntry[];
	root: string;
	workers: number;
	/** Bundle the sources once, for every render. */
	prepare(): Promise<void>;
	/** Render one entry and write its screenshot; the theme it rendered in, when it says. */
	render(
		id: string,
		checkpoint: string,
		context: Partial<SpecimenContext>,
		screenshot: string,
		timeoutMs: number | undefined
	): Promise<SpecimenTheme | null>;
}

/** Render each selected entry in every theme, one theme at a time, and compare the frames. */
export async function runThemes(host: ThemesHost, request: ThemesRequest): Promise<ThemesRun> {
	const entries = request.id
		? host.entries.filter((entry) => entry.id === request.id)
		: selectEntries(host.entries, request.filter, host.root);
	if (request.id && !entries.length) throw new Error(`Specimen not found: ${request.id}`);
	if (!entries.length) throw new Error('No specimen or retained story matches the filter.');
	const themes = request.themes ?? [...THEMES];
	const threshold = request.threshold ?? DEFAULT_THEME_THRESHOLD;
	const checkpoint = request.checkpoint ?? 'mount';
	const workers = request.workers ?? host.workers;
	const started = performance.now();
	await host.prepare();
	const directory = await mkdtemp(join(tmpdir(), 'specimen-themes-'));
	try {
		let next = 0;
		const reports = await pool(entries, workers, async (entry) => {
			const slot = next++;
			const frames: ThemeFrame[] = [];
			// Each frame is a few megabytes decoded; an entry's are dropped once it is classified.
			const pixels: (Pixels | null)[] = [];
			for (const [index, theme] of themes.entries()) {
				const file = join(directory, `${slot}-${index}.png`);
				try {
					const rendered = await host.render(
						entry.id,
						checkpoint,
						{ ...DEFAULT_THEME_CONTEXT, ...request.context, theme },
						file,
						request.timeoutMs
					);
					pixels.push(decodePng(await readFile(file)));
					frames.push({ theme, rendered });
				} catch (error) {
					pixels.push(null);
					frames.push({
						theme,
						rendered: null,
						reason: error instanceof Error ? error.message : String(error),
					});
				} finally {
					await rm(file, { force: true });
				}
			}
			return themeReport(
				entry,
				frames,
				(a, b) => changedShare(pixels[a] as Pixels, pixels[b] as Pixels),
				threshold
			);
		});
		return {
			themes,
			checkpoint,
			threshold,
			...themesSummary(reports),
			workers,
			elapsedMs: performance.now() - started,
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

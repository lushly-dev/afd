#!/usr/bin/env node
/**
 * T04 build and load budgets. For each consumer: Specimen's static build of the native wrapper
 * project (shell versus consumer chunks), the JavaScript each case actually loads in Chromium
 * (raw, gzip and brotli), and two prototype bundles built from the consumer's own installs: the
 * play helpers retained stories import from `storybook/test`, and axe-core with a minimal runner.
 * The prototypes size categories Specimen does not ship yet; they are not delivered integrations.
 */
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { build } from 'vite';
import { prepareConsumerProject } from './consumer-project.mjs';
import fastAf from './fast-af.fixture.mjs';
import lushly from './lushly.fixture.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1];
};
const output = resolve(option('--out', `test-results/specimens-budgets-${Date.now()}`));
const roots = { 'fast-af': option('--fast-af'), lushly: option('--lushly') };
const apiPath = resolve(option('--api', join(import.meta.dirname, '../dist/index.js')));
const { createSpecimenBench } = await import(pathToFileURL(apiPath).href);
const policy = JSON.parse(
	await readFile(join(import.meta.dirname, 'inputs/baseline-policy.json'), 'utf8')
);
const budgets = policy.budgets;
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('--out must be empty');

export const sizes = (bytes) => ({
	raw: bytes.length,
	gzip: gzipSync(bytes, { level: 9 }).length,
	brotli: brotliCompressSync(bytes).length,
});
const sum = (items) =>
	items.reduce(
		(total, item) => ({
			raw: total.raw + item.raw,
			gzip: total.gzip + item.gzip,
			brotli: total.brotli + item.brotli,
		}),
		{ raw: 0, gzip: 0, brotli: 0 }
	);

/** Bundle `source` minified with the consumer's own installs, outside its snapshot. */
async function prototype(name, source, snapshot, alias = {}) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), `specimen-budget-${name}-`)));
	try {
		await symlink(join(snapshot, 'node_modules'), join(directory, 'node_modules'), 'dir');
		await writeFile(join(directory, 'entry.mjs'), source);
		const result = await build({
			configFile: false,
			root: directory,
			logLevel: 'silent',
			resolve: { alias },
			build: {
				write: false,
				minify: true,
				// Vite leaves ES library output's whitespace unminified; IIFE output is fully
				// minified, like the shell's application build.
				lib: {
					entry: join(directory, 'entry.mjs'),
					formats: ['iife'],
					name: `SpecimenPrototype_${name}`,
					fileName: name,
				},
				rolldownOptions: { external: [] },
			},
		});
		const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
		const chunks = outputs.filter((entry) => entry.type === 'chunk');
		return {
			source,
			chunks: chunks.map((chunk) => ({ file: chunk.fileName, ...sizes(Buffer.from(chunk.code)) })),
			...sum(chunks.map((chunk) => sizes(Buffer.from(chunk.code)))),
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function serve(directory) {
	const mime = {
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
	};
	const server = createServer((request, response) => {
		void (async () => {
			try {
				const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
				const file = resolve(directory, `.${path === '/' ? '/index.html' : path}`);
				if (relative(directory, file).startsWith('..')) throw new Error('outside');
				const body = await readFile(file);
				response.writeHead(200, {
					'content-type': mime[extname(file)] ?? 'application/octet-stream',
				});
				response.end(body);
			} catch {
				response.writeHead(404).end();
			}
		})();
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((done) => server.close(() => done())),
	};
}

/** Load one case of a static build in Chromium and account for every response it fetched. */
async function loadedBytes(browser, base, id) {
	const page = await browser.newPage();
	const responses = [];
	page.on('response', (response) => {
		responses.push(
			response
				.body()
				.then((body) => ({
					path: new URL(response.url()).pathname,
					type: response.request().resourceType(),
					...sizes(body),
				}))
				.catch(() => null)
		);
	});
	try {
		await page.goto(`${base}/specimen.html?id=${id}&frame=1`);
		await page.waitForFunction(() => document.querySelector('#specimen-root')?.childElementCount);
		await page.waitForLoadState('networkidle');
	} finally {
		await page.close();
	}
	const loaded = (await Promise.all(responses)).filter(Boolean);
	return {
		id,
		script: sum(loaded.filter((entry) => entry.type === 'script')),
		all: sum(loaded),
		responses: loaded,
	};
}

const report = {
	purpose: 'T04 build and load budgets with prototype helper and axe bundles',
	createdUtc: new Date().toISOString(),
	budgets,
	consumers: {},
};
const browser = await chromium.launch({ headless: true });
try {
	for (const descriptor of [fastAf, lushly]) {
		const snapshot = roots[descriptor.name];
		if (!snapshot) continue;
		const project = await realpath(
			await mkdtemp(join(tmpdir(), `specimen-budget-${descriptor.name}-`))
		);
		const result = {};
		report.consumers[descriptor.name] = result;
		try {
			await prepareConsumerProject(descriptor, resolve(snapshot), project);
			const bench = await createSpecimenBench({ root: project });
			const staticDirectory = join(output, descriptor.name, 'static');
			try {
				result.build = await bench.build(staticDirectory);
			} finally {
				await bench.close();
			}
			const manifest = JSON.parse(
				await readFile(join(staticDirectory, 'specimen-build.json'), 'utf8')
			);
			const chunk = async (entry) => ({
				...entry,
				...sizes(await readFile(join(staticDirectory, entry.file))),
			});
			const chunks = await Promise.all(manifest.chunks.map(chunk));
			result.categories = {
				shell: sum(chunks.filter((entry) => entry.category === 'shell')),
				consumer: sum(chunks.filter((entry) => entry.category === 'consumer')),
			};
			const server = await serve(staticDirectory);
			try {
				result.loaded = [];
				for (const { id } of descriptor.specimens)
					result.loaded.push(await loadedBytes(browser, server.url, id));
			} finally {
				await server.close();
			}
			const axePackage = (await readdir(join(snapshot, 'node_modules/.pnpm'))).find((name) =>
				name.startsWith('axe-core@')
			);
			result.prototypes = {
				helpers: await prototype(
					'helpers',
					"export { expect, fn, userEvent, waitFor, within } from 'storybook/test';\n",
					snapshot
				),
				axe: axePackage
					? await prototype(
							'axe',
							"import axe from 'axe-core';\nexport const runAxe = (root, options) => axe.run(root, options);\n",
							snapshot,
							{
								'axe-core': join(
									snapshot,
									'node_modules/.pnpm',
									axePackage,
									'node_modules/axe-core/axe.min.js'
								),
							}
						)
					: null,
			};
			const shell = result.categories.shell.raw;
			const helpers = result.prototypes.helpers.raw;
			const axe = result.prototypes.axe?.raw ?? null;
			result.verdicts = {
				shell: { bytes: shell, budget: budgets.shell, passes: shell <= budgets.shell },
				helpers: { bytes: helpers, budget: budgets.helpers, passes: helpers <= budgets.helpers },
				axe: { bytes: axe, budget: budgets.axe, passes: axe !== null && axe <= budgets.axe },
				total: {
					bytes: axe === null ? null : shell + helpers + axe,
					budget: budgets.total,
					passes: axe !== null && shell + helpers + axe <= budgets.total,
					note: 'Shell plus the two prototypes; shared helpers would be counted once',
				},
			};
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	}
} finally {
	await browser.close();
}
await writeFile(join(output, 'budgets.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const [name, result] of Object.entries(report.consumers)) {
	process.stdout.write(`${name}\n`);
	for (const [category, verdict] of Object.entries(result.verdicts))
		process.stdout.write(
			`  ${category}: ${verdict.bytes} / ${verdict.budget} ${verdict.passes ? 'passes' : 'FAILS'}\n`
		);
	for (const entry of result.loaded)
		process.stdout.write(
			`  loaded ${entry.id}: script ${entry.script.raw} raw, ${entry.script.gzip} gzip, ${entry.script.brotli} brotli\n`
		);
}

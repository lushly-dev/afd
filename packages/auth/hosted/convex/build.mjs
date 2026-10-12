import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

export async function buildFixture(outputDir) {
	await mkdir(outputDir, { recursive: true });
	await build({
		entryPoints: [join(fixtureDir, 'app.tsx')],
		outfile: join(outputDir, 'bundle.js'),
		bundle: true,
		format: 'esm',
		platform: 'browser',
		sourcemap: false,
		minify: false,
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'silent',
	});
	await writeFile(join(outputDir, 'index.html'), await readFile(join(fixtureDir, 'index.html')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const outputDir = process.argv[2];
	if (!outputDir) throw new Error('Usage: node build.mjs <output-directory>');
	await buildFixture(outputDir);
}

/**
 * @fileoverview What `loam app new` writes (phase 1 specification, section 11). No `ui`, so the first
 * UI is the console (D48). Strings a person chose are written through `JSON.stringify`, so they cannot
 * change the shape of what they land in.
 */

import { AFD_CONTRACT, TRUST_LINES_V1 } from '@lushly-dev/loam-manifest';

export type AppKind = 'native' | 'view' | 'mounted';

const titleOf = (id: string): string => `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
const json = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`;

function manifestToml(id: string, kind: AppKind): string {
	const name = JSON.stringify(id);
	const head = [
		'manifest_version = 1',
		'protocol = 1',
		`afd_contract = ${JSON.stringify(AFD_CONTRACT)}`,
		'',
		'[plugin]',
		`id = ${name}`,
		`title = ${JSON.stringify(titleOf(id))}`,
		'version = "0.1.0"',
		`description = ${JSON.stringify(`The ${titleOf(id)} app; describe what it is for.`)}`,
		`kind = ${JSON.stringify(kind)}`,
		`domains = [${name}]`,
		'license = "MIT"',
		'',
	];
	if (kind === 'mounted') {
		return [...head, '[mount]', `prefix = ${name}`, 'transport = "http"', ''].join('\n');
	}
	const section =
		kind === 'native'
			? ['[native]', 'entry = "dist/native.js"']
			: ['[view]', 'handlers = "dist/handlers.html"'];
	return [
		...head,
		...section,
		'',
		'[[commands]]',
		`name = ${JSON.stringify(`${id}-ping`)}`,
		`title = ${JSON.stringify(`Ping ${titleOf(id)}`)}`,
		`description = ${JSON.stringify(`Returns a pong, to show that ${titleOf(id)} is loaded.`)}`,
		`category = ${name}`,
		'effects = ["inspect"]',
		`input_schema = ${JSON.stringify(`schemas/${id}-ping.input.json`)}`,
		'',
	].join('\n');
}

function appSource(id: string): string {
	return `import { defineApp, success } from '@lushly-dev/loam-sdk';

export default defineApp({
	sdk: 1,
	handlers: {
		${JSON.stringify(`${id}-ping`)}: async () => success({ pong: true }, { reasoning: 'The app is loaded.' }),
	},
});
`;
}

const HANDLERS_SOURCE = `import { serveHandlers } from '@lushly-dev/loam-sdk/view';
import app from './app.js';

serveHandlers(app);
`;

const HANDLERS_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Handlers</title>
		<script type="module" src="./handlers.ts"></script>
	</head>
	<body></body>
</html>
`;

function mainPage(id: string): string {
	return `<!doctype html>
<!-- Not listed yet: add [ui] with a resource and a main surface to the manifest to show this. -->
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${titleOf(id)}</title>
	</head>
	<body>
		<h1>${titleOf(id)}</h1>
		<p id="answer">Waiting for the shell.</p>
		<script type="module">
			import { connectView } from '@lushly-dev/loam-sdk/view';

			const view = await connectView({ name: ${JSON.stringify(id).replaceAll('"', "'")}, version: '0.1.0' });
			const result = await view.client.call(${JSON.stringify(`${id}-ping`).replaceAll('"', "'")});
			document.getElementById('answer').textContent = JSON.stringify(result.data ?? result.error);
		</script>
	</body>
</html>
`;
}

const NATIVE_VITE = `import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		lib: { entry: 'src/app.ts', formats: ['es'], fileName: () => 'native.js' },
	},
});
`;

const VIEW_VITE = `import { singleFileHtml } from '@lushly-dev/loam-cli/vite';
import { defineConfig } from 'vite';

// One build per page, since a page must be one file: \`vite build --mode main\` or \`--mode handlers\`.
export default defineConfig(({ mode }) => ({
	root: 'src',
	plugins: [singleFileHtml()],
	build: {
		outDir: '../dist',
		emptyOutDir: false,
		rollupOptions: { input: \`src/\${mode === 'handlers' ? 'handlers' : 'main'}.html\` },
	},
}));
`;

const TSCONFIG = {
	compilerOptions: {
		target: 'ES2022',
		lib: ['ES2024', 'DOM', 'DOM.Iterable'],
		module: 'NodeNext',
		moduleResolution: 'NodeNext',
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		verbatimModuleSyntax: true,
		types: ['node'],
	},
	include: ['src', 'test', 'vite.config.ts'],
};

/**
 * The code that runs in the browser, checked without Node's globals or `node:` modules, as the
 * repository's apps are (#811). tsconfig.json keeps Node's types for the test and the Vite config.
 */
const TSCONFIG_BROWSER = {
	extends: './tsconfig.json',
	compilerOptions: { types: [] },
	include: ['src'],
	exclude: ['**/*.test.ts'],
};

function appTest(id: string): string {
	return `import { fileURLToPath } from 'node:url';
import { readAppManifest } from '@lushly-dev/loam-cli';
import { createAppTestKernel } from '@lushly-dev/loam-testing';
import { describe, expect, it } from 'vitest';
import definition from '../src/app.js';

describe(${JSON.stringify(id).replaceAll('"', "'")}, () => {
	it('answers its command', async () => {
		const manifest = await readAppManifest(fileURLToPath(new URL('..', import.meta.url)));
		const { kernel } = await createAppTestKernel({ manifest, definition });
		const result = await kernel.call(${JSON.stringify(`${id}-ping`).replaceAll('"', "'")});
		expect(result.success).toBe(true);
	});
});
`;
}

/** A path names one package, so `--dep-spec` may name the unit: `link:/repo/packages/{unit}`. */
const specFor = (depSpec: string, unit: string): string => depSpec.replaceAll('{unit}', unit);

function packageJson(id: string, kind: AppKind, depSpec: string): string {
	const cli = specFor(depSpec, 'cli');
	const base = {
		name: `loam-app-${id}`,
		version: '0.1.0',
		private: true,
		type: 'module',
	};
	if (kind === 'mounted') {
		return json({
			...base,
			scripts: { check: 'loam app check .', pack: 'loam app pack . --out dist/package' },
			devDependencies: { '@lushly-dev/loam-cli': cli },
		});
	}
	return json({
		...base,
		scripts: {
			build:
				kind === 'native' ? 'vite build' : 'vite build --mode main && vite build --mode handlers',
			check: 'loam app check .',
			pack: 'loam app pack . --out dist/package',
			test: 'vitest run',
			typecheck: 'tsc && tsc -p tsconfig.browser.json',
		},
		dependencies: { '@lushly-dev/loam-sdk': specFor(depSpec, 'sdk') },
		devDependencies: {
			'@lushly-dev/loam-cli': cli,
			'@lushly-dev/loam-testing': specFor(depSpec, 'testing'),
			'@types/node': '^26.6.6',
			typescript: '^7.0.2',
			vite: '^8.3.0',
			vitest: '^5.1.0',
		},
	});
}

function readme(id: string, kind: AppKind): string {
	const steps =
		kind === 'mounted'
			? '`loam app check .` checks the manifest and `loam app pack . --out dist/package` packs it. A deployment entry names the instance, its URL and its credential; the console is its UI.'
			: '`vite build` builds it, `loam app check .` checks it, `loam app pack . --out dist/package` packs it, and `vitest run` runs its test. It has no `ui` yet, so the console is its first UI.';
	return `# ${titleOf(id)}

A Loam ${kind} app.

${TRUST_LINES_V1[kind].line}

${steps}
`;
}

/** Every file of a new app, by its path relative to the app. */
export function scaffold(id: string, kind: AppKind, depSpec: string): Record<string, string> {
	const files: Record<string, string> = {
		'loam-app.toml': manifestToml(id, kind),
		'package.json': packageJson(id, kind, depSpec),
		'README.md': readme(id, kind),
	};
	if (kind === 'mounted') return files;
	files[`schemas/${id}-ping.input.json`] = json({
		type: 'object',
		properties: {},
		additionalProperties: false,
	});
	files['src/app.ts'] = appSource(id);
	files['tsconfig.json'] = json(TSCONFIG);
	files['tsconfig.browser.json'] = json(TSCONFIG_BROWSER);
	files['test/app.test.ts'] = appTest(id);
	if (kind === 'native') {
		files['vite.config.ts'] = NATIVE_VITE;
	} else {
		files['vite.config.ts'] = VIEW_VITE;
		files['src/handlers.ts'] = HANDLERS_SOURCE;
		files['src/handlers.html'] = HANDLERS_PAGE;
		files['src/main.html'] = mainPage(id);
	}
	return files;
}

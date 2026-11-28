#!/usr/bin/env node
/**
 * Synchronizes CI workflow path filters from `scripts/ci/workflow-graph.mjs` and generates
 * `scripts/affected/suites.generated.mjs` directly from `.github/workflows/*.yml` (#1800).
 *
 * Usage:
 *   node scripts/sync-ci.mjs --check   # exit 1 on any drift between graph, workflows, and suites
 *   node scripts/sync-ci.mjs --write   # rewrite drifted workflow path blocks and suites.generated.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from './ci/parse-workflow.mjs';
import { resolveWorkflowPaths, WORKFLOW_GRAPH } from './ci/workflow-graph.mjs';

const UNFILTERED = new Set(['ci.yml', 'ci-ok.yml']);

/**
 * Local suite extraction specification per path-filtered workflow.
 *
 * Steps are extracted from the parsed workflow YAML jobs (verified against the workflow's actual
 * steps and gates) with minimal local adaptations (adding `--no-fail-fast` to `cargo test`,
 * stripping CI-only `--reporter=github-actions`, and naming remote-only legs).
 */
const SUITE_CONFIG = [
	{
		workflow: 'violet.yml',
		tools: ['chromium'],
		extract(wf) {
			requireGate(wf, 'run');
			requireStepRun(wf, 'suites-and-consumers', 'lint');
			requireStepRun(wf, 'suites-and-consumers', 'test:db');
			requireStepRun(wf, 'suites-and-consumers', 'verify-artifacts.mjs');
			const lintStep = findStep(wf, 'suites-and-consumers', (s) =>
				/violet-server lint$/.test(s.run)
			);
			const testStep = findStep(wf, 'suites-and-consumers', (s) =>
				/violet-server test$/.test(s.run)
			);
			return [
				{ gate: 'run', run: 'pnpm test:violet' },
				{ gate: 'run', run: lintStep.run },
				{ gate: 'run', run: testStep.run.replace(/^pnpm -F /, 'pnpm --no-bail -F ') },
			];
		},
	},
	{
		workflow: 'fast-af.yml',
		tools: ['chromium'],
		remote:
			'fast-element on Firefox and WebKit (daily) and its upstream test:ci documentation checks, and violet-elements on Firefox and WebKit (run locally with pnpm -F @lushly-dev/violet-elements test:browser:all)',
		extract(wf) {
			requireGate(wf, 'runtime');
			requireGate(wf, 'components');
			const runtimeBuild = findStep(
				wf,
				'runtime',
				(s) => s.run === 'pnpm -F @lushly-dev/fast-element build'
			);
			requireStepRun(wf, 'runtime', 'test:chromium');
			const compBuild = findStep(wf, 'components', (s) =>
				s.run.includes('violet-elements..." build')
			);
			const compTypecheck = findStep(wf, 'components', (s) =>
				s.run.includes('violet-elements typecheck')
			);
			const compExports = findStep(wf, 'components', (s) =>
				s.run.includes('violet-elements verify:exports')
			);
			requireStepRun(wf, 'components', 'theme:build');
			const compTaxonomy = findStep(wf, 'components', (s) =>
				s.run.includes('violet-elements taxonomy:check')
			);
			const compLint = findStep(wf, 'components', (s) => s.run.includes('violet-elements lint'));
			const compBrowser = findStep(
				wf,
				'components',
				(s) => s.run === 'pnpm -F @lushly-dev/violet-elements test:browser'
			);
			requireStepRun(wf, 'components', 'violet-elements test:browser:firefox');
			requireStepRun(wf, 'components', 'violet-elements test:browser:webkit');
			requireStepRun(wf, 'components', 'tests/consumers/fast-af/verify-artifacts.mjs');
			return [
				{ gate: 'runtime', run: runtimeBuild.run },
				{ gate: 'runtime', run: 'pnpm -F @lushly-dev/fast-element test:chromium' },
				{ gate: 'components', run: compBuild.run },
				{ gate: 'components', run: compTypecheck.run },
				{ gate: 'components', run: compExports.run },
				{ gate: 'components', run: 'node scripts/fast-af-generated.mjs' },
				{ gate: 'components', run: compTaxonomy.run },
				{ gate: 'components', run: compLint.run },
				{ gate: 'components', run: compBrowser.run },
				{
					gate: 'components',
					run: 'node tests/consumers/fast-af/verify-artifacts.mjs --browser chromium',
				},
			];
		},
	},
	{
		workflow: 'specimen.yml',
		tools: ['chromium', 'cargo'],
		remote:
			"the prebuilt hosts of the other platforms (host-packages); pnpm test:specimen packs this one's",
		extract(wf) {
			requireGate(wf, 'run');
			requireGate(wf, 'stories');
			requireGate(wf, 'host');
			requireGate(wf, 'hosts');
			requireStepRun(wf, 'browser-and-consumers', 'test:browser');
			requireStepRun(wf, 'stories', 'test:stories');
			requireStepRun(wf, 'host-packages', 'build:host');
			const hostSteps = extractCargoSteps(wf, 'host', { gate: 'host' });
			return [
				{ gate: 'run', run: 'pnpm test:specimen' },
				{ gate: 'stories', run: 'pnpm test:stories' },
				...hostSteps,
				{
					gate: 'hosts',
					run: 'pnpm -F @lushly-dev/specimen build:host && pnpm -F @lushly-dev/specimen stage:host',
				},
			];
		},
	},
	{
		workflow: 'health-dashboard.yml',
		tools: ['chromium', 'uv'],
		extract(wf) {
			requireGate(wf, 'run');
			const picks = [
				(s) => s.run.includes('health-dashboard..." build'),
				(s) => s.run.includes('fixtures:check'),
				(s) => s.run.includes('verify-health-isolation.mjs'),
				(s) => s.run.includes('test:browser'),
			];
			return picks.map((pred) => ({ gate: 'run', run: findStep(wf, 'dashboard', pred).run }));
		},
	},
	{
		workflow: 'loam.yml',
		tools: ['chromium', 'cargo', 'openssl'],
		extract(wf) {
			requireGate(wf, 'run');
			requireGate(wf, 'mounted');
			requireGate(wf, 'hosted');
			const steps = [];
			const mountedBuild = findStep(wf, 'mounted', (s) => s.run.includes('loam-web..."'));
			steps.push({ gate: 'mounted', run: mountedBuild.run });
			const typecheck = findStep(wf, 'loam', (s) => s.run.includes('typecheck'));
			steps.push({ gate: 'run', run: typecheck.run });
			const unit = findStep(wf, 'loam', (s) => s.run.includes('test --coverage'));
			steps.push({
				gate: 'run',
				run: stripCiReporter(unit.run).replace(/^pnpm -F /, 'pnpm --no-bail -F '),
			});
			for (const name of ["AFD's lean path", "AFD's identity path"]) {
				const step = findStep(wf, 'loam', (s) => s.name === name);
				for (const line of splitCommands(step.run)) {
					steps.push({ gate: 'run', run: stripCiReporter(line) });
				}
			}
			for (const pred of [
				(s) => s.run.includes('theme:check'),
				(s) => s.run.includes('lint:tokens'),
				(s) => s.run.includes('test:browser'),
			]) {
				steps.push({ gate: 'run', run: findStep(wf, 'loam', pred).run });
			}
			steps.push({
				gate: 'run',
				run: findStep(wf, 'walk', (s) => s.run.includes('test:walk')).run,
			});
			steps.push({
				gate: 'run',
				run: findStep(wf, 'firefox', (s) => s.run.includes('test:firefox')).run,
			});
			steps.push({
				gate: 'run',
				platform: 'darwin',
				run: findStep(wf, 'webkit', (s) => s.run.includes('test:webkit')).run,
			});
			steps.push({ gate: 'run', run: findStep(wf, 'loam', (s) => s.run.includes('budget')).run });
			steps.push({
				gate: 'mounted',
				run: findStep(wf, 'mounted', (s) => s.run.includes('test:mounted')).run,
			});
			const hostedBuild = findStep(wf, 'hosted', (s) => s.run.includes('loam-host..." build'));
			steps.push({ gate: 'hosted', run: hostedBuild.run });
			const hostedTypecheck = findStep(wf, 'hosted', (s) => s.run.includes('typecheck:hosted'));
			for (const line of splitCommands(hostedTypecheck.run)) {
				steps.push({ gate: 'hosted', run: line });
			}
			const hostedUnit = findStep(wf, 'hosted', (s) => s.run.includes('loam-host test --coverage'));
			steps.push({ gate: 'hosted', run: stripCiReporter(hostedUnit.run) });
			const hostPath = findStep(wf, 'hosted', (s) => s.name === "AFD's host path");
			for (const line of splitCommands(hostPath.run)) {
				steps.push({ gate: 'hosted', run: stripCiReporter(line) });
			}
			steps.push({
				gate: 'hosted',
				run: findStep(wf, 'hosted', (s) => s.run.includes('test:hosted')).run,
			});
			return steps;
		},
	},
	{
		workflow: 'auth-browser.yml',
		tools: ['chromium'],
		extract(wf) {
			const build = findStep(
				wf,
				'browser',
				(s) => s.run.includes('afd-auth') && s.run.includes('build')
			);
			const test = findStep(wf, 'browser', (s) => s.run.includes('test:browser'));
			return [
				{ run: build.run.replace(/@lushly-dev\/afd-auth\.\.\./, '"@lushly-dev/afd-auth..."') },
				{ run: test.run },
			];
		},
	},
	{
		workflow: 'hosted-fixtures.yml',
		tools: ['chromium', 'openssl'],
		extract(wf) {
			const step = findStep(wf, 'local', (s) => s.run.includes('test:hosted:local'));
			return [{ run: step.run }];
		},
	},
	{
		workflow: 'python.yml',
		tools: ['uv'],
		remote: 'Python 3.11 to 3.14, the wheel install smoke test per extra, and the Windows test job',
		extract(wf) {
			return extractUvSteps(wf, 'test', { includeRuffFormat: true });
		},
	},
	{
		workflow: 'alfred.yml',
		tools: ['uv'],
		remote: 'Python 3.11 and the isolated wheel smoke test',
		extract(wf) {
			return extractUvSteps(wf, 'test-and-package', {
				includeRuffFormat: true,
				rewrite: (cmd) => cmd.replace(/pytest tests\/ -v$/, 'pytest tests/ -q'),
			});
		},
	},
	{
		workflow: 'botcore.yml',
		tools: ['uv'],
		remote: 'Python 3.11',
		extract(wf) {
			const buildStep = findStep(wf, 'core-and-package', (s) =>
				s.run.includes('afd-testing..." build')
			);
			const steps = [{ run: buildStep.run }];
			steps.push(...extractUvSteps(wf, 'core-and-package', { includeRuffFormat: true }));
			for (const script of ['scripts/package_tests.py', 'scripts/package_smoke.py']) {
				const s = findStep(wf, 'core-and-package', (st) => st.run.includes(script));
				steps.push({ cwd: wf.jobs['core-and-package'].defaultWorkingDirectory, run: s.run });
			}
			return steps;
		},
	},
	{
		workflow: 'botcore-factory.yml',
		tools: ['uv'],
		remote: 'Python 3.11, and the suite on Linux, macOS and Windows',
		extract(wf) {
			const buildStep = findStep(wf, 'plugin', (s) => s.run.includes('afd-testing..." build'));
			const buildLine = splitCommands(buildStep.run).find((l) => l.includes('afd-testing'));
			const uvSteps = extractUvSteps(wf, 'plugin', {
				includeRuffFormat: true,
				rewrite: (cmd) => cmd.replace(/ --python \$\{\{[^}]+\}\}/g, ''),
			});
			return [{ run: buildLine }, ...uvSteps];
		},
	},
	{
		workflow: 'health.yml',
		tools: ['uv'],
		remote: 'Python 3.11',
		extract(wf) {
			const steps = extractUvSteps(wf, 'test-and-package', {
				includeRuffFormat: true,
				rewrite: (cmd) => cmd.replace(/ --python \$\{\{[^}]+\}\}/g, ''),
			});
			const smoke = findStep(wf, 'test-and-package', (s) => s.run.includes('package_smoke.py'));
			steps.push({ cwd: wf.jobs['test-and-package'].defaultWorkingDirectory, run: smoke.run });
			return steps;
		},
	},
	{
		workflow: 'rust.yml',
		tools: ['cargo'],
		remote:
			'the wasm32 checks and tests, the MSRV matrix, the docs.rs build, and the Windows test job',
		extract(wf) {
			return extractCargoSteps(wf, 'check', {
				skip: (cmd) =>
					(cmd.includes('journal-file-shared') && cmd.startsWith('cargo clippy')) ||
					cmd.includes('--target wasm32-unknown-unknown'),
			});
		},
	},
	{
		workflow: 'loam-plugins.yml',
		tools: ['cargo', 'chromium'],
		remote:
			'Linux, the release-profile test-doubles check, and the Linux scenario run against loam-mail test-world',
		extract(wf) {
			requireGate(wf, 'mail');
			requireGate(wf, 'mailapp');
			requireGate(wf, 'violet');
			const mailSteps = extractCargoSteps(wf, 'mail', { gate: 'mail' }).map((step) => ({
				...step,
				tools: ['cargo'],
			}));
			// A plugin app's job: its pnpm steps, under the gate of the same name.
			const pnpmSteps = (job) => {
				const found = wf.jobs[job];
				if (!found) throw new Error(`loam-plugins.yml is missing job "${job}"`);
				const steps = found.steps
					.filter((s) => typeof s.run === 'string' && s.run.startsWith('pnpm '))
					.map((s) => ({
						gate: job,
						tools: s.run.includes('test:specimen') ? ['cargo', 'chromium'] : [],
						run: s.run,
					}));
				if (steps.length === 0) throw new Error(`loam-plugins.yml job "${job}" has no pnpm steps`);
				return steps;
			};
			return [...mailSteps, ...pnpmSteps('mailapp'), ...pnpmSteps('violet')];
		},
	},
	{
		workflow: 'loam-desktop.yml',
		tools: ['cargo'],
		remote:
			"the WebDriver suite (P6-D1 to P6-D4, P6-D6, P6-D7, P5-A1, P5-A2, P5-A6, P5-A8, P5-A9 with the mail engine's test build) under tauri-driver on Linux (PRs) and Windows (daily/manual), the macOS WKWebView checks (test:macos), and each OS's unsigned installers and P6-D5 HTTPS updater suite (Build the installers)",
		extract(wf) {
			requireGate(wf, 'run');
			const cargo = extractCargoSteps(wf, 'linux', { gate: 'run' });
			return [
				...cargo,
				{
					gate: 'run',
					cwd: 'endpoints/loam/packages/desktop/src-tauri',
					run: 'cargo build --locked',
				},
			];
		},
	},
	{
		workflow: 'umbel.yml',
		tools: ['cargo'],
		remote:
			'Linux, the per-feature and wasm32-wasip2 clippy legs, plugin isolation, and daily MSRV 1.97 and Windows store and clippy checks',
		extract(wf) {
			requireGate(wf, 'host');
			requireGate(wf, 'loamos');
			requireGate(wf, 'conformance');
			const cwd = wf.jobs.check.defaultWorkingDirectory;
			const loamOsCwd = wf.jobs['loam-os']?.defaultWorkingDirectory;
			const loamOsSteps = [
				findStep(wf, 'loam-os', (s) => s.run === 'cargo fmt --all --check'),
				findStep(wf, 'loam-os', (s) => s.run.startsWith('cargo clippy --locked')),
				findStep(wf, 'loam-os', (s) => s.run.startsWith('cargo test --no-fail-fast')),
			].map((step) => ({ gate: 'loamos', cwd: loamOsCwd, run: step.run }));
			const fmt = findStep(wf, 'check', (s) => s.run === 'cargo fmt --all --check');
			const clippy = findStep(wf, 'check', (s) =>
				s.run.startsWith('cargo clippy --locked --workspace')
			);
			const buildComp = findStep(wf, 'check', (s) =>
				s.run.startsWith('cargo build --locked --release --target wasm32-wasip2')
			);
			const buildHello = findStep(wf, 'check', (s) =>
				s.run.startsWith('cargo build --locked -p umbel-plugin-hello')
			);
			requireStepRun(wf, 'knowledge', 'umbel-store-embedded');
			const confSteps = wf.jobs.conformance.steps
				.filter(
					(s) =>
						s.run &&
						(s.run.includes('afd-cli') ||
							s.run.includes('test:conformance:umbel') ||
							s.run.includes('external-clients.sh'))
				)
				.map((s) => {
					if (s.run.includes('afd-cli'))
						return { gate: 'conformance', run: 'pnpm -F "@lushly-dev/afd-cli..." build' };
					if (s.run.includes('external-clients.sh'))
						return {
							gate: 'conformance',
							run: 'bash endpoints/umbel/tests/scripts/external-clients.sh',
						};
					return { gate: 'conformance', run: s.run };
				});
			return [
				{ gate: 'host', cwd, run: fmt.run },
				{ gate: 'host', cwd, run: clippy.run },
				{
					gate: 'host',
					cwd,
					run: 'cargo clippy --locked --target wasm32-wasip2 -p umbel-plugin-components --features component -- -D warnings',
				},
				{ gate: 'host', cwd, run: buildComp.run },
				{ gate: 'host', cwd, run: buildHello.run },
				{
					gate: 'host',
					cwd,
					run: 'cargo test --no-fail-fast --locked --workspace --exclude umbel-store-embedded',
				},
				{
					gate: 'host',
					cwd,
					run: 'cargo clippy --locked -p umbel-store -p umbel-store-embedded --all-targets -- -D warnings',
				},
				{
					gate: 'host',
					cwd,
					run: 'cargo test --no-fail-fast --locked -p umbel-store -p umbel-store-embedded',
				},
				...loamOsSteps,
				...confSteps,
			];
		},
	},
	{
		workflow: 'cpp.yml',
		tools: ['cmake'],
		remote:
			'clang-format, the sanitizer and no-exceptions legs, and MSVC on the dev preset; daily: TSan, macOS, MSVC release, clang-cl, Emscripten, packaging, benchmarks and fuzz',
		extract(wf) {
			const buildStep = findStep(wf, 'build', (s) => s.run.includes('cmake --build --preset'));
			const testStep = findStep(wf, 'build', (s) => s.run.includes('ctest --preset'));
			const cwd = wf.jobs.build.defaultWorkingDirectory;
			const localPreset = (cmd) => cmd.replaceAll('${{ matrix.preset }}', 'dev').trim();
			return [
				{ cwd, run: 'cmake --preset dev' },
				{ cwd, run: localPreset(buildStep.run) },
				{ cwd, run: localPreset(testStep.run) },
			];
		},
	},
	{
		workflow: 'conformance.yml',
		tools: ['uv', 'cargo', 'cmake'],
		remote:
			"every backend's MCP 2026-07-28 runs (--mode modern), the TypeScript and Python confirmation suites, the Rust backend's fmt and clippy, the C++ backend unit tests, and the C++ backend's MSVC build on Windows",
		extract(wf) {
			requireGate(wf, 'todo');
			requireGate(wf, 'rust');
			requireGate(wf, 'cpp');
			const steps = [];
			const todoJob = wf.jobs.todo;
			for (const s of todoJob.steps) {
				if (!s.run) continue;
				for (const line of splitCommands(s.run)) {
					if (line === 'pnpm build') {
						steps.push({ gate: 'todo', tools: [], run: line });
					} else if (
						s.workingDirectory === 'packages/examples/todo/backends/python' &&
						/^uv (?:sync|run)\b/.test(line)
					) {
						steps.push({ gate: 'todo', tools: ['uv'], cwd: s.workingDirectory, run: line });
					}
				}
			}
			const rustTest = findStep(wf, 'todo-rust', (s) => s.run.startsWith('cargo test'));
			steps.push({
				gate: 'rust',
				tools: ['cargo'],
				cwd: rustTest.workingDirectory,
				run: withNoFailFast(rustTest.run),
			});
			for (const s of todoJob.steps) {
				if (!s.run) continue;
				const r = s.run.trim();
				if (r.includes('--suite confirmations')) continue;
				if (r.includes('--mode modern') && !r.includes('--suite tasks')) continue;
				if (
					r.startsWith('pnpm --dir packages/examples/todo test:') ||
					r.startsWith('node tests/consumers/afd/verify-artifacts.mjs') ||
					r.startsWith('pnpm -F @afd/example-todo-directclient-page test:browser')
				) {
					const needsUv = r.includes(':py') || r.includes('test:interop');
					steps.push({ gate: 'todo', tools: needsUv ? ['uv'] : [], run: r });
				}
			}
			for (const [jobId, gate, tool] of [
				['todo-rust', 'rust', 'cargo'],
				['todo-cpp', 'cpp', 'cmake'],
			]) {
				for (const s of wf.jobs[jobId].steps) {
					if (!s.run) continue;
					const r = s.run.trim();
					if (!r.startsWith('pnpm --dir packages/examples/todo test:conformance:')) continue;
					if (r.includes('--mode modern') && !r.includes('--suite tasks')) continue;
					steps.push({ gate, tools: [tool], run: r });
				}
			}
			return steps;
		},
	},
];

function requireGate(wf, gateId) {
	if (!wf.gates.has(gateId)) {
		throw new Error(`Workflow "${wf.name}" is missing expected gate step "${gateId}"`);
	}
}

function findStep(wf, jobId, predicate) {
	const job = wf.jobs[jobId];
	if (!job) throw new Error(`Workflow "${wf.name}" is missing job "${jobId}"`);
	const step = job.steps.find((s) => s.run && predicate(s));
	if (!step) throw new Error(`Workflow "${wf.name}" job "${jobId}" is missing expected step`);
	return step;
}

function requireStepRun(wf, jobId, needle) {
	findStep(wf, jobId, (s) => s.run.includes(needle));
}

function splitCommands(runText) {
	return runText
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));
}

function stripCiReporter(cmd) {
	return cmd.replace(/\s+--reporter=github-actions\b/g, '');
}

function withNoFailFast(cmd) {
	if (!cmd.startsWith('cargo test') || cmd.includes('--no-fail-fast')) return cmd;
	return cmd.replace(/^cargo test\b/, 'cargo test --no-fail-fast');
}

function extractCargoSteps(wf, jobId, { gate, skip } = {}) {
	const job = wf.jobs[jobId];
	if (!job) throw new Error(`Workflow "${wf.name}" is missing job "${jobId}"`);
	const out = [];
	for (const step of job.steps) {
		if (!step.run) continue;
		const cwd = step.workingDirectory ?? job.defaultWorkingDirectory;
		for (const raw of splitCommands(step.run)) {
			if (!/^cargo (?:fmt|clippy|test)\b/.test(raw)) continue;
			if (skip?.(raw)) continue;
			const cmd = withNoFailFast(raw);
			out.push({ ...(gate ? { gate } : {}), ...(cwd ? { cwd } : {}), run: cmd });
		}
	}
	return out;
}

function extractUvSteps(wf, jobId, { includeRuffFormat = false, rewrite = (c) => c } = {}) {
	const job = wf.jobs[jobId];
	if (!job) throw new Error(`Workflow "${wf.name}" is missing job "${jobId}"`);
	const out = [];
	for (const step of job.steps) {
		if (!step.run) continue;
		const cwd = step.workingDirectory ?? job.defaultWorkingDirectory;
		for (const raw of splitCommands(step.run)) {
			const isUv =
				/^uv lock --check\b/.test(raw) ||
				/^uv sync\b/.test(raw) ||
				/^uv run\b.*\bruff check\b/.test(raw) ||
				(includeRuffFormat && /^uv run\b.*\bruff format --check\b/.test(raw)) ||
				/^uv run\b.*\bmypy\b/.test(raw) ||
				/^uv run\b.*\bpytest\b/.test(raw);
			if (!isUv) continue;
			out.push({ ...(cwd ? { cwd } : {}), run: rewrite(raw) });
		}
	}
	return out;
}

/**
 * Replace `paths:` lists under `on.push:` and `on.pull_request:` in workflow YAML text
 * with the canonical path list from `workflow-graph.mjs`, preserving the rest of the file.
 */
export function rewriteWorkflowPaths(text, paths) {
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.replaceAll('\r\n', '\n').split('\n');
	const out = [];
	let inOn = false;
	let trigger = null;

	const stripInlineComment = (raw) => {
		let quote = null;
		for (let j = 0; j < raw.length; j++) {
			const ch = raw[j];
			if (quote) {
				if (ch === quote) quote = null;
			} else if (ch === "'" || ch === '"') {
				quote = ch;
			} else if (ch === '#' && (j === 0 || /\s/.test(raw[j - 1]))) {
				return raw.slice(0, j).trim();
			}
		}
		return raw.trim();
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^on:(?:\s+#.*)?\s*$/.test(line)) {
			inOn = true;
			trigger = null;
			out.push(line);
			continue;
		}
		if (inOn && /^[a-zA-Z_]/.test(line)) {
			inOn = false;
			trigger = null;
		}
		if (inOn) {
			const trigMatch =
				/^ {2}(push|pull_request|merge_group|schedule|workflow_dispatch|workflow_call):(?:\s+#.*)?\s*$/.exec(
					line
				);
			if (trigMatch) {
				trigger = trigMatch[1];
				out.push(line);
				continue;
			}
			if ((trigger === 'push' || trigger === 'pull_request') && /^ {4}paths:(.*)$/.test(line)) {
				const rest = stripInlineComment(/^ {4}paths:(.*)$/.exec(line)[1]);
				out.push('    paths:');
				for (const p of paths) out.push(`      - '${p}'`);
				if (!rest) {
					// Consume the existing block sequence (including comments/blank lines inside it).
					while (i + 1 < lines.length && /^( {6}(- |#)|\s*$)/.test(lines[i + 1])) {
						// Stop if the blank line precedes a sibling key or next trigger.
						if (
							lines[i + 1].trim() === '' &&
							i + 2 < lines.length &&
							!/^ {6}(- |#)/.test(lines[i + 2])
						) {
							break;
						}
						i++;
					}
				}
				continue;
			}
		}
		out.push(line);
	}
	return out.join(eol);
}

export function renderSuitesModule(suites) {
	const header = [
		'// Auto-generated from .github/workflows/*.yml by scripts/sync-ci.mjs (#1800).',
		'// Do not edit by hand; run `pnpm ci:sync` after changing workflow steps or gates.',
		'',
		'/** @type {{ workflow: string, tools: string[], steps: { run: string, cwd?: string, gate?: string, platform?: string, tools?: string[] }[], remote?: string }[]} */',
		`export const SUITES = ${JSON.stringify(suites, null, '\t')};`,
		'',
	].join('\n');
	return header;
}

export function syncCi(root, { write = false } = {}) {
	const wfDir = join(root, '.github/workflows');
	const allWorkflows = readdirSync(wfDir)
		.filter((f) => /\.ya?ml$/.test(f))
		.sort();

	const parsed = new Map();
	const filteredWorkflows = [];
	for (const file of allWorkflows) {
		const text = readFileSync(join(wfDir, file), 'utf8');
		const wf = parseWorkflow(text);
		parsed.set(file, { text, wf });
		if (wf.triggers.pull_request && !UNFILTERED.has(file)) {
			filteredWorkflows.push(file);
		}
	}

	const drifted = [];

	// 1. Check graph coverage in both directions.
	const graphKeys = Object.keys(WORKFLOW_GRAPH).sort();
	for (const file of filteredWorkflows) {
		if (!Object.hasOwn(WORKFLOW_GRAPH, file)) {
			throw new Error(
				`Path-filtered workflow "${file}" is missing from scripts/ci/workflow-graph.mjs`
			);
		}
	}
	for (const file of graphKeys) {
		if (!filteredWorkflows.includes(file)) {
			throw new Error(
				`WORKFLOW_GRAPH lists "${file}", which is not a path-filtered pull_request workflow`
			);
		}
	}

	// 2. Sync push.paths and pull_request.paths for each workflow in WORKFLOW_GRAPH.
	for (const file of graphKeys) {
		const { text, wf } = parsed.get(file);
		const expectedPaths = resolveWorkflowPaths(file);
		const updated = rewriteWorkflowPaths(text, expectedPaths);
		const updatedWf = updated === text ? wf : parseWorkflow(updated);
		const prMatches =
			JSON.stringify(updatedWf.triggers.pull_request?.paths ?? null) ===
			JSON.stringify(expectedPaths);
		const pushMatches =
			!updatedWf.triggers.push ||
			JSON.stringify(updatedWf.triggers.push.paths ?? null) === JSON.stringify(expectedPaths);
		if (!prMatches || !pushMatches) {
			throw new Error(
				`${file}: missing or unreadable push/pull_request paths block (expected ${expectedPaths.length} path(s))`
			);
		}
		if (updated !== text) {
			drifted.push(`.github/workflows/${file}`);
			if (write) {
				writeFileSync(join(wfDir, file), updated, 'utf8');
				parsed.set(file, { text: updated, wf: updatedWf });
			}
		}
	}

	// 3. Generate scripts/affected/suites.generated.mjs from the parsed workflows.
	const suiteNames = SUITE_CONFIG.map((s) => s.workflow).sort();
	if (JSON.stringify(suiteNames) !== JSON.stringify(filteredWorkflows)) {
		throw new Error(
			`SUITE_CONFIG workflows (${suiteNames.join(', ')}) differ from path-filtered workflows (${filteredWorkflows.join(', ')})`
		);
	}
	const generatedSuites = SUITE_CONFIG.map((spec) => {
		const { wf } = parsed.get(spec.workflow);
		const steps = spec.extract(wf);
		const entry = { workflow: spec.workflow, tools: spec.tools };
		if (spec.remote) entry.remote = spec.remote;
		entry.steps = steps;
		return entry;
	});

	const suitesPath = join(root, 'scripts/affected/suites.generated.mjs');
	const expectedSuitesText = renderSuitesModule(generatedSuites);
	let currentSuitesText = null;
	try {
		currentSuitesText = readFileSync(suitesPath, 'utf8').replaceAll('\r\n', '\n');
	} catch {}
	if (currentSuitesText !== expectedSuitesText) {
		drifted.push('scripts/affected/suites.generated.mjs');
		if (write) writeFileSync(suitesPath, expectedSuitesText, 'utf8');
	}

	return { drifted, workflows: graphKeys.length, suites: generatedSuites.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const write = args.includes('--write');
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	try {
		const result = syncCi(root, { write });
		if (result.drifted.length === 0) {
			console.log(
				`sync-ci: ${result.workflows} workflow path filters and ${result.suites} generated local suites are in sync.`
			);
		} else if (write) {
			console.log(
				`sync-ci: updated ${result.drifted.length} file(s):\n${result.drifted.join('\n')}`
			);
		} else {
			console.error(
				`sync-ci: ${result.drifted.length} file(s) out of sync (run \`pnpm ci:sync\`):\n${result.drifted.join('\n')}`
			);
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(`sync-ci: ${error.message}`);
		process.exitCode = 1;
	}
}

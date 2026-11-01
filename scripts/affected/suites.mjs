/**
 * The local equivalents of the path-filtered workflows, so `pnpm verify` can run on this machine
 * what a pull request would run remotely.
 *
 * A suite runs when its workflow's `pull_request.paths` filter matches the change, read from the
 * workflow itself. A step bound to a `gate` runs only when that `Affected units` step of the
 * workflow (`node scripts/affected.mjs gate ...`) would pass. ci.yml is `pnpm check`, which
 * `pnpm verify` runs first.
 *
 * `remote` names what only the workflow covers (other operating systems, Node or Python versions,
 * browsers or sanitizers); the daily and pull-request runs remain the check for those.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIOLET = [
	'@lushly-dev/violet-core',
	'@lushly-dev/violet-runtime',
	'@lushly-dev/violet-afd',
	'@lushly-dev/violet-cli',
	'@lushly-dev/violet-server',
];
const filters = (names) => names.map((name) => `-F ${name}`).join(' ');

/** @typedef {{ run: string, cwd?: string, gate?: string }} Step */
/** @type {{ workflow: string, tools: string[], steps: Step[], remote?: string }[]} */
export const SUITES = [
	{
		workflow: 'violet.yml',
		tools: ['chromium'],
		steps: [
			{ gate: 'run', run: 'pnpm test:violet' },
			{ gate: 'run', run: `pnpm ${filters(VIOLET)} lint` },
			{
				gate: 'run',
				run: 'pnpm -F @lushly-dev/violet-runtime -F @lushly-dev/violet-cli -F @lushly-dev/violet-server test',
			},
		],
	},
	{
		workflow: 'fast-af.yml',
		tools: ['chromium'],
		remote:
			'fast-element on Firefox and WebKit (daily), and its upstream test:ci documentation checks',
		steps: [
			{ gate: 'runtime', run: 'pnpm -F @lushly-dev/fast-element build' },
			{ gate: 'runtime', run: 'pnpm -F @lushly-dev/fast-element test:chromium' },
			{ gate: 'components', run: 'pnpm -F "@lushly-dev/violet-elements..." build' },
			{ gate: 'components', run: 'pnpm -F @lushly-dev/violet-elements lint' },
			{ gate: 'components', run: 'pnpm -F @lushly-dev/violet-elements test:browser' },
			{
				gate: 'components',
				run: 'node tests/consumers/fast-af/verify-artifacts.mjs --browser chromium',
			},
		],
	},
	{
		workflow: 'specimen.yml',
		tools: ['chromium', 'cargo'],
		steps: [
			{ gate: 'run', run: 'pnpm test:specimen' },
			{ gate: 'host', cwd: 'foundations/specimen/host', run: 'cargo fmt --check' },
			{
				gate: 'host',
				cwd: 'foundations/specimen/host',
				run: 'cargo clippy --locked --all-targets -- -D warnings',
			},
			{ gate: 'host', cwd: 'foundations/specimen/host', run: 'cargo test --locked' },
		],
	},
	{
		workflow: 'health-dashboard.yml',
		tools: ['chromium', 'uv'],
		steps: [
			{ gate: 'run', run: 'pnpm -F "@lushly-dev/health-dashboard..." build' },
			{ gate: 'run', run: 'pnpm -F @lushly-dev/health-dashboard fixtures:check' },
			{ gate: 'run', run: 'node endpoints/health-dashboard/scripts/verify-health-isolation.mjs' },
			{ gate: 'run', run: 'pnpm -F @lushly-dev/health-dashboard test:browser' },
		],
	},
	{
		workflow: 'loam.yml',
		tools: ['chromium', 'cargo'],
		steps: [
			{ gate: 'run', run: 'pnpm -F "@lushly-dev/loam-web..." build' },
			{ gate: 'run', run: 'pnpm -F "./endpoints/loam/packages/*" test --coverage' },
			{ gate: 'run', run: 'pnpm -F @lushly-dev/loam-theme theme:check' },
			{
				gate: 'run',
				run: 'pnpm -F @lushly-dev/loam-theme -F @lushly-dev/loam-chrome lint:tokens',
			},
			{ gate: 'run', run: 'pnpm -F @lushly-dev/specimen build:host' },
			{ gate: 'run', run: 'pnpm -F @lushly-dev/loam-web test:browser' },
			{ gate: 'run', run: 'pnpm -F @lushly-dev/loam-web budget' },
		],
	},
	{
		workflow: 'auth-browser.yml',
		tools: ['chromium'],
		steps: [
			{ run: 'pnpm -F "@lushly-dev/afd-auth..." build' },
			{ run: 'pnpm -F @lushly-dev/afd-auth test:browser' },
		],
	},
	{
		workflow: 'hosted-fixtures.yml',
		tools: ['chromium', 'openssl'],
		steps: [{ run: 'pnpm test:hosted:local' }],
	},
	{
		workflow: 'python.yml',
		tools: ['uv'],
		remote: 'Python 3.10 and 3.11, and the wheel install smoke test per extra',
		steps: [
			{ cwd: 'python', run: 'uv lock --check' },
			{ cwd: 'python', run: 'uv sync --frozen --all-extras' },
			{ cwd: 'python', run: 'uv run ruff check --select F821,F841,B904 src' },
			{ cwd: 'python', run: 'uv run pytest -q' },
		],
	},
	{
		workflow: 'alfred.yml',
		tools: ['uv'],
		remote: 'Python 3.11 and the isolated wheel smoke test',
		steps: [
			{ cwd: 'alfred', run: 'uv lock --check' },
			{ cwd: 'alfred', run: 'uv sync --all-extras --dev --frozen' },
			{ cwd: 'alfred', run: 'uv run --locked ruff check .' },
			{ cwd: 'alfred', run: 'uv run --locked pytest tests/ -q' },
		],
	},
	{
		workflow: 'botcore.yml',
		tools: ['uv'],
		remote: 'Python 3.11',
		steps: [
			{ cwd: 'endpoints/botcore', run: 'uv lock --check' },
			{ cwd: 'endpoints/botcore', run: 'uv sync --frozen --extra dev --extra mcp --extra cdp' },
			{
				cwd: 'endpoints/botcore',
				run: 'uv run --frozen ruff check src/ tests/ scripts/ packages/botcore-agents/src/',
			},
			{
				cwd: 'endpoints/botcore',
				run: 'uv run --frozen pytest tests/ --ignore=tests/integration -q',
			},
			{ cwd: 'endpoints/botcore', run: 'uv run --frozen python scripts/package_smoke.py' },
		],
	},
	{
		workflow: 'health.yml',
		tools: ['uv'],
		remote: 'Python 3.11',
		steps: [
			{ cwd: 'endpoints/health', run: 'uv lock --check' },
			{ cwd: 'endpoints/health', run: 'uv sync --frozen --extra dev' },
			{ cwd: 'endpoints/health', run: 'uv run --frozen ruff check src tests scripts' },
			{ cwd: 'endpoints/health', run: 'uv run --frozen ruff format --check src tests scripts' },
			{ cwd: 'endpoints/health', run: 'uv run --frozen pytest -q' },
			{ cwd: 'endpoints/health', run: 'uv run --frozen python scripts/package_smoke.py' },
		],
	},
	{
		workflow: 'rust.yml',
		tools: ['cargo'],
		remote: 'the wasm32 checks and the docs.rs build',
		steps: [
			{ cwd: 'packages/rust', run: 'cargo fmt --check' },
			{ cwd: 'packages/rust', run: 'cargo clippy --all-targets -- -D warnings' },
			{
				cwd: 'packages/rust',
				run: 'cargo clippy --all-targets --no-default-features -- -D warnings',
			},
			{ cwd: 'packages/rust', run: 'cargo clippy --all-targets --features server -- -D warnings' },
			{ cwd: 'packages/rust', run: 'cargo test' },
			{ cwd: 'packages/rust', run: 'cargo test --no-default-features' },
			{ cwd: 'packages/rust', run: 'cargo test --features server' },
			{ cwd: 'packages/rust', run: 'cargo test --features journal-file-shared' },
			{
				cwd: 'packages/rust',
				run: 'cargo clippy --all-targets --no-default-features --features frontmatter -- -D warnings',
			},
			{ cwd: 'packages/rust', run: 'cargo test --no-default-features --features frontmatter' },
		],
	},
	{
		workflow: 'umbel.yml',
		tools: ['cargo'],
		remote:
			'Linux, the per-feature and wasm32-wasip2 clippy legs, MSRV 1.97 (daily) and plugin isolation',
		steps: [
			{ gate: 'host', cwd: 'endpoints/umbel', run: 'cargo fmt --all --check' },
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo clippy --locked --workspace --exclude umbel-store-embedded --all-targets -- -D warnings',
			},
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo build --locked --release --target wasm32-wasip2 -p umbel-fixture-behaviors -p umbel-fixture-imports -p umbel-fixture-sockets -p umbel-fixture-future -p umbel-plugin-hello --features umbel-plugin-hello/component',
			},
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo build --locked -p umbel-plugin-hello --features mounted --bin hello-mcp',
			},
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo test --locked --workspace --exclude umbel-store-embedded',
			},
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo clippy --locked -p umbel-store -p umbel-store-embedded --all-targets -- -D warnings',
			},
			{
				gate: 'host',
				cwd: 'endpoints/umbel',
				run: 'cargo test --locked -p umbel-store -p umbel-store-embedded',
			},
			// The conformance job runs for every trigger, including todo example and CLI changes.
			{ run: 'pnpm -F "@lushly-dev/afd-cli..." build' },
			{ run: 'pnpm --filter @afd/example-todo test:conformance:umbel' },
			{ run: 'pnpm --filter @afd/example-todo test:conformance:umbel --mode modern' },
			{
				run: 'pnpm --filter @afd/example-todo test:conformance:umbel --suite confirmations --mode modern',
			},
			{ run: 'pnpm --filter @afd/example-todo test:conformance:umbel-mounted' },
			{ run: 'pnpm --filter @afd/example-todo test:conformance:umbel-mounted --mode modern' },
			{
				run: 'bash endpoints/umbel/tests/scripts/external-clients.sh endpoints/umbel/target/debug/umbel-todo packages/cli/dist/bin.js packages/examples/todo/scenarios',
			},
		],
	},
	{
		workflow: 'cpp.yml',
		tools: ['cmake'],
		remote:
			'clang-format, the sanitizer and no-exceptions legs; daily: TSan, Windows, MSVC, Emscripten, packaging, benchmarks and fuzz',
		steps: [
			{ cwd: 'packages/cpp', run: 'cmake --preset dev' },
			{ cwd: 'packages/cpp', run: 'cmake --build --preset dev' },
			{ cwd: 'packages/cpp', run: 'ctest --preset dev' },
		],
	},
	{
		workflow: 'conformance.yml',
		tools: ['uv', 'cargo', 'cmake'],
		remote: 'the Rust backend clippy and the C++ backend unit tests',
		steps: [
			{ gate: 'todo', run: 'pnpm build' },
			{ gate: 'todo', cwd: 'packages/examples/todo/backends/python', run: 'uv sync --locked' },
			{
				gate: 'todo',
				cwd: 'packages/examples/todo/backends/python',
				run: 'uv run --locked pytest -q',
			},
			{ gate: 'rust', cwd: 'packages/examples/todo/backends/rust', run: 'cargo test --locked' },
			{ gate: 'todo', run: 'pnpm --dir packages/examples/todo test:conformance:ts' },
			{ gate: 'todo', run: 'pnpm --dir packages/examples/todo test:conformance:py' },
			{ gate: 'rust', run: 'pnpm --dir packages/examples/todo test:conformance:rs' },
			{ gate: 'cpp', run: 'pnpm --dir packages/examples/todo test:conformance:cpp' },
		],
	},
];

/** Converts a GitHub Actions path filter to a regular expression. */
export function filterPattern(glob) {
	let source = '';
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*' && glob[index + 1] === '*') {
			source += '.*';
			index++;
		} else if (char === '*') source += '[^/]*';
		else if (char === '?') source += '[^/]';
		else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${source}$`);
}

/** Whether a path filter list (later `!` entries exclude, later entries re-include) matches a file. */
export function matchesFilters(filters, file) {
	let matched = false;
	for (const filter of filters) {
		const negated = filter.startsWith('!');
		if (filterPattern(negated ? filter.slice(1) : filter).test(file)) matched = !negated;
	}
	return matched;
}

/**
 * The pull-request trigger of a workflow: `{ paths }` (null when every change triggers it) and
 * its `gate` steps by id as argument lists, or null when pull requests do not trigger it.
 */
export function readTrigger(text) {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => /^ {2}pull_request:/.test(line));
	if (start === -1) return null;
	let paths = null;
	for (let index = start + 1; index < lines.length && /^( {4}|$)/.test(lines[index]); index++) {
		const key = /^ {4}paths:(.*)$/.exec(lines[index]);
		if (!key) continue;
		const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
		const flow = /^\s*\[(.*)\]\s*$/.exec(key[1]);
		paths = flow ? flow[1].split(',').map(unquote) : [];
		for (let item = index + 1; !flow && /^ {6}(- |#)/.test(lines[item] ?? ''); item++)
			if (lines[item].startsWith('      - '))
				paths.push(unquote(lines[item].replace(/^ {6}- /, '').replace(/\s+#.*$/, '')));
		if (paths.length === 0) throw new Error(`unreadable pull_request.paths: ${lines[index]}`);
	}
	const gates = new Map();
	const step = /- id: (\S+)\n\s+run: node scripts\/affected\.mjs gate ([^\n]+)/g;
	for (const match of text.matchAll(step)) gates.set(match[1], match[2].trim().split(/\s+/));
	return { paths, gates };
}

export function readSuiteTrigger(root, suite) {
	return readTrigger(readFileSync(join(root, '.github/workflows', suite.workflow), 'utf8'));
}

/**
 * Single declared input graph for AFD's path-filtered CI workflows (#1800).
 *
 * Every path-filtered workflow's `push.paths` and `pull_request.paths` are derived from this
 * graph by `scripts/sync-ci.mjs`. Shared inputs (actions, queue workflow, lockfiles, crates,
 * packages, spec subsets) live in one place so adding or changing a shared input updates every
 * workflow that depends on it, and `node scripts/sync-ci.mjs --check` fails on any drift.
 */

export const GROUPS = {
	// Shared CI infrastructure
	queueWorkflow: ['.github/workflows/queue.yml'],
	setupAction: ['.github/actions/setup-node-pnpm/**'],
	playwrightAction: ['.github/actions/playwright-install/**'],
	cppDepsAction: ['.github/actions/cpp-dependencies/**'],
	pnpmLock: ['pnpm-lock.yaml'],
	pnpmWorkspace: ['pnpm-workspace.yaml'],
	cargoConfig: ['.cargo/config.toml'],

	// Core AFD TypeScript packages
	afdCore: ['packages/core/**'],
	afdServer: ['packages/server/**'],
	afdClient: ['packages/client/**'],
	afdCli: ['packages/cli/**'],
	afdAuth: ['packages/auth/**'],
	afdLocalDb: ['packages/local-db/**'],
	afdViewState: ['packages/view-state/**'],
	afdTesting: ['packages/testing/**'],
	afdAdapters: ['packages/adapters/**'],

	// Native AFD implementations
	python: ['python/**'],
	rust: ['packages/rust/**'],
	cpp: ['packages/cpp/**'],

	// Contract spec inputs
	specNonMarkdown: ['spec/**', '!spec/**/*.md'],
	specPluginManifest: ['spec/plugin-manifest*', 'spec/VERSION'],

	// Foundations & integrations
	fastAf: ['foundations/fast-af/**'],
	violet: [
		'foundations/violet/**',
		'integrations/violet-afd/**',
		'endpoints/violet-cli/**',
		'endpoints/violet-server/**',
	],
	specimenCore: [
		'foundations/specimen/**',
		'integrations/specimen-afd/**',
		'integrations/specimen-afd-runner/**',
		'integrations/specimen-fast-af/**',
		'endpoints/specimen-cli/**',
	],

	// Endpoints
	alfred: ['alfred/**'],
	botcore: ['endpoints/botcore/**'],
	health: ['endpoints/health/**'],
	healthDashboard: ['endpoints/health-dashboard/**'],
	umbel: ['endpoints/umbel/**', '!endpoints/umbel/docs/**'],
	// The host's scenario harness reads the feature's scenarios and fixtures (Loam OS M1 step 2).
	loamOs: [
		'endpoints/loam-os/**',
		'!endpoints/loam-os/image/**',
		'docs/features/active/loam-os/scenarios/**',
	],
	loamCore: ['endpoints/loam/**', '!endpoints/loam/docs/**', '!endpoints/loam/plugins/**'],
	loamWithScenarios: [
		'endpoints/loam/**',
		'!endpoints/loam/docs/**',
		'endpoints/loam/docs/phases/*/scenarios/**',
		'!endpoints/loam/plugins/**',
	],
	loamPlugins: [
		'endpoints/loam/plugins/**',
		'!endpoints/loam/plugins/*/docs/**',
		'endpoints/loam/plugins/*/docs/scenarios/**',
	],

	// Examples
	todoExample: ['packages/examples/todo/**'],
	todoDirectClient: ['packages/examples/todo-directclient/**'],
	// Shared gate scripts
	gateScripts: [
		'scripts/check-test-*.mjs',
		'scripts/discovery-parsers.mjs',
		'scripts/report-test-changes.mjs',
	],
};

/**
 * Per-workflow input declarations. Each entry expands its `groups` + `extra` paths, plus its
 * own `.github/workflows/<file>` and `.github/workflows/queue.yml` (and `.github/actions/setup-node-pnpm/**`
 * when `usesSetupAction` is true).
 */
export const WORKFLOW_GRAPH = {
	'alfred.yml': {
		usesSetupAction: true,
		groups: ['alfred', 'python', 'botcore', 'gateScripts'],
		extra: [
			'scripts/release*/**',
			'scripts/release-*.mjs',
			'architecture.json',
			'botcore.toml',
			'skills/exports.json',
			'scripts/skill-profiles*.mjs',
			'.claude/skills/**',
			'.agents/skills',
			'package.json',
			'pnpm-lock.yaml',
			'.nvmrc',
			'spec/**',
			'packages/**',
		],
	},
	'auth-browser.yml': {
		usesSetupAction: true,
		groups: ['afdAuth', 'afdCore', 'pnpmLock', 'playwrightAction'],
	},
	'botcore-factory.yml': {
		usesSetupAction: true,
		groups: ['botcore', 'python', 'afdCore', 'afdTesting', 'pnpmLock', 'gateScripts'],
		extra: [
			'docs/features/active/software-factory/scenarios/**',
			'scripts/issue-labels.mjs',
			'scripts/pre-push.mjs',
			'scripts/verify-record.mjs',
			'scripts/affected/**',
			'scripts/release/exec-tool.mjs',
			'.github/labels.json',
			'botcore.toml',
		],
	},
	'botcore.yml': {
		// The core tests run the gate outcome jobs through AFD's scenario runner, which is
		// afd-testing built with its dependencies.
		usesSetupAction: true,
		groups: ['botcore', 'python', 'afdCore', 'afdServer', 'afdClient', 'afdTesting', 'pnpmLock'],
		extra: [
			'.github/workflows/publish-botcore.yml',
			'docs/features/active/test-effectiveness/scenarios/**',
		],
	},
	'conformance.yml': {
		usesSetupAction: true,
		groups: [
			'todoExample',
			'todoDirectClient',
			'afdServer',
			'afdCore',
			'afdCli',
			'afdClient',
			'afdTesting',
			'afdLocalDb',
			'afdViewState',
			'fastAf',
			'rust',
			'cpp',
			'python',
			'specNonMarkdown',
			'pnpmLock',
			'cargoConfig',
			'playwrightAction',
			'cppDepsAction',
		],
		extra: ['tests/consumers/afd/**', 'tests/consumers/pnpm.mjs', 'scripts/release/exec-tool.mjs'],
	},
	'cpp.yml': {
		usesSetupAction: false,
		groups: ['cpp', 'specNonMarkdown', 'cppDepsAction'],
		extra: ['packages/examples/todo/spec/**', 'packages/examples/todo/backends/cpp/**'],
	},
	'fast-af.yml': {
		usesSetupAction: true,
		groups: ['fastAf', 'pnpmLock', 'pnpmWorkspace', 'playwrightAction'],
		extra: [
			'tests/consumers/fast-af/**',
			'scripts/release/exec-tool.mjs',
			'scripts/codemods/split-define.mjs',
			// theme:build copies violet-runtime's naming rule; the regenerate-and-diff step checks it.
			'foundations/violet/packages/runtime/src/property.ts',
		],
	},
	'health-dashboard.yml': {
		usesSetupAction: true,
		groups: [
			'healthDashboard',
			'health',
			'fastAf',
			'pnpmLock',
			'pnpmWorkspace',
			'playwrightAction',
		],
	},
	'health.yml': {
		usesSetupAction: false,
		groups: ['health', 'botcore', 'python'],
		extra: ['LICENSE'],
	},
	'hosted-fixtures.yml': {
		usesSetupAction: true,
		groups: [
			'afdAuth',
			'afdLocalDb',
			'afdViewState',
			'afdCore',
			'afdServer',
			'pnpmLock',
			'playwrightAction',
		],
		extra: [
			'scripts/run-hosted-local.mjs',
			'scripts/release/exec-tool.mjs',
			'scripts/hosted/**',
			'package.json',
		],
	},
	'loam-desktop.yml': {
		usesSetupAction: true,
		groups: [
			// With the scenario folders: the desktop runs phase 5's slice from them (P5-A1).
			'loamWithScenarios',
			'rust',
			'fastAf',
			'afdCore',
			'afdTesting',
			'afdServer',
			'afdViewState',
			'afdAuth',
			'afdLocalDb',
			'afdClient',
			'pnpmLock',
			'pnpmWorkspace',
			'cargoConfig',
		],
		extra: [
			'endpoints/loam/plugins/mail/engine/**',
			'endpoints/loam/plugins/mail/mount/**',
			'endpoints/loam/plugins/mail/app/**',
			'foundations/violet/**',
			'integrations/violet-afd/**',
		],
	},
	'loam-plugins.yml': {
		usesSetupAction: true,
		groups: [
			'loamPlugins',
			'rust',
			'cargoConfig',
			'afdAuth',
			'afdClient',
			'afdCore',
			'afdLocalDb',
			'afdServer',
			'afdTesting',
			'afdViewState',
			'pnpmLock',
			'playwrightAction',
		],
		extra: [
			'endpoints/loam/packages/cli/**',
			'endpoints/loam/packages/copilot/**',
			'endpoints/loam/packages/kernel/**',
			'endpoints/loam/packages/manifest/**',
			'endpoints/loam/packages/sdk/**',
			'endpoints/loam/packages/testing/**',
			'endpoints/loam/packages/theme/**',
			'foundations/fast-af/packages/**',
			'foundations/specimen/**',
			'foundations/violet/**',
			'integrations/specimen-fast-af/**',
			'integrations/violet-afd/**',
		],
	},
	'loam.yml': {
		usesSetupAction: true,
		groups: [
			'loamWithScenarios',
			'fastAf',
			'afdCore',
			'afdServer',
			'afdViewState',
			'afdAuth',
			'afdLocalDb',
			'afdClient',
			'afdAdapters',
			'afdTesting',
			'umbel',
			'rust',
			'specPluginManifest',
			'pnpmLock',
			'pnpmWorkspace',
			'cargoConfig',
			'playwrightAction',
		],
		extra: [
			'foundations/violet/**',
			'foundations/specimen/**',
			'integrations/specimen-afd-runner/**',
			'integrations/violet-afd/**',
			'architecture.json',
			// The web host's ceiling-raises unit reads the decision log (#2926); the rest of the docs folder is prose.
			'endpoints/loam/docs/decisions.md',
		],
	},
	'python.yml': {
		usesSetupAction: false,
		groups: ['python', 'specNonMarkdown'],
		extra: ['.github/workflows/publish-python.yml', 'scripts/python-wheel-smoke.py'],
	},
	'rust.yml': {
		usesSetupAction: false,
		groups: ['rust', 'specNonMarkdown', 'cargoConfig'],
	},
	'specimen.yml': {
		usesSetupAction: true,
		groups: [
			'specimenCore',
			'afdCore',
			'afdServer',
			'afdTesting',
			'pnpmLock',
			'cargoConfig',
			'playwrightAction',
		],
		extra: [
			'foundations/fast-af/packages/element/packages/fast-element/**',
			'foundations/fast-af/packages/violet-elements/**',
			'tests/consumers/pnpm.mjs',
			'tests/consumers/specimen/**',
			'tests/consumers/pnpm.mjs',
			'scripts/release/exec-tool.mjs',
		],
	},
	'umbel.yml': {
		usesSetupAction: true,
		groups: [
			'umbel',
			'loamOs',
			'rust',
			'todoExample',
			'afdCli',
			'afdClient',
			'afdCore',
			'afdServer',
			'afdTesting',
			'cargoConfig',
		],
		extra: [
			'foundations/specimen/defaults/pack/**',
			'foundations/specimen/fixtures/pack/**',
			'foundations/specimen/schema/pack/**',
			'foundations/specimen/docs/pack-format.md',
			'foundations/fast-af/packages/violet-elements/pack/**',
			'foundations/fast-af/packages/violet-elements/specimen.config.json',
			'foundations/fast-af/packages/violet-elements/package.json',
			// The `umbel` crate's `versions::` tests check its schema surfaces there (Umbel's D213).
			'architecture.json',
			// `tests/it/manifest_core.rs` runs the shared plugin manifest's cases on them (Umbel's D220).
			'spec/plugin-manifest.core.v1.json',
			'spec/plugin-manifest.json',
		],
	},
	'violet.yml': {
		usesSetupAction: true,
		groups: ['violet', 'afdCore', 'pnpmLock', 'pnpmWorkspace', 'playwrightAction'],
		// The selector contract violet-runtime reproduces; the packed consumers check its parity.
		extra: [
			'tests/consumers/violet/**',
			'tests/consumers/pnpm.mjs',
			'scripts/release/exec-tool.mjs',
			'foundations/fast-af/packages/violet-elements/tokens/interface.json',
			'foundations/fast-af/packages/violet-elements/src/theme/violet-theme-css.ts',
			// violet-theme-css.ts imports it; the consumer check runs that source in Node.
			'foundations/fast-af/packages/violet-elements/src/theme/generated/violet-token-property.generated.ts',
		],
	},
};

/** Resolve the deduplicated ordered path filter list for a workflow in WORKFLOW_GRAPH. */
export function resolveWorkflowPaths(file) {
	const spec = WORKFLOW_GRAPH[file];
	if (!spec) throw new Error(`Unknown workflow in WORKFLOW_GRAPH: ${file}`);
	const raw = [];
	for (const groupName of spec.groups ?? []) {
		const group = GROUPS[groupName];
		if (!group) throw new Error(`Unknown group "${groupName}" referenced by ${file}`);
		raw.push(...group);
	}
	raw.push(...(spec.extra ?? []));
	raw.push(`.github/workflows/${file}`);
	raw.push(...GROUPS.queueWorkflow);
	if (spec.usesSetupAction) raw.push(...GROUPS.setupAction);

	// Deduplicate while preserving order (important for `!` negations following their parent glob).
	const seen = new Set();
	const out = [];
	for (const pattern of raw) {
		if (seen.has(pattern)) continue;
		seen.add(pattern);
		out.push(pattern);
	}
	return out;
}

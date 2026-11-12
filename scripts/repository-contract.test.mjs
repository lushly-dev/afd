import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import './view-state-package.test.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function ensureBuilt(packageDirectory, requiredFiles) {
	const distDirectory = join(repoRoot, packageDirectory, 'dist');
	if (requiredFiles.every((file) => existsSync(join(distDirectory, file)))) return;

	execFileSync('pnpm', ['--dir', packageDirectory, 'build'], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
}

function copyBuiltPackage(packageDirectory, consumerRoot) {
	const source = join(repoRoot, packageDirectory);
	const packageManifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
	const destination = join(consumerRoot, 'node_modules', ...packageManifest.name.split('/'));
	mkdirSync(destination, { recursive: true });
	cpSync(join(source, 'package.json'), join(destination, 'package.json'));
	cpSync(join(source, 'dist'), join(destination, 'dist'), { recursive: true });
}

function linkPeer(consumerRoot, packageName, source) {
	const destination = join(consumerRoot, 'node_modules', ...packageName.split('/'));
	mkdirSync(dirname(destination), { recursive: true });
	symlinkSync(source, destination, 'dir');
}

function runConsumer(consumerRoot, source) {
	const entrypoint = join(consumerRoot, 'consumer.mjs');
	writeFileSync(entrypoint, source);
	execFileSync(process.execPath, [entrypoint], { cwd: consumerRoot, stdio: 'pipe' });
}

test('release documentation and workflow agree with root scripts', () => {
	const manifest = JSON.parse(read('package.json'));
	const agents = read('AGENTS.md');
	// AGENTS.md routes shipping to do-prepare-pr, which carries the changeset rule.
	const ship = read('.claude/skills/do-prepare-pr/SKILL.md');
	const release = read('.github/workflows/release.yml');

	assert.equal(typeof manifest.scripts.changeset, 'string');
	assert.equal(typeof manifest.scripts['version-packages'], 'string');
	assert.equal(manifest.scripts['test:coverage'], 'pnpm -r --no-bail test --coverage');
	for (const text of [agents, ship]) {
		assert.doesNotMatch(text, /pnpm release patch|scripts\/release\.mjs|push origin main --tags/);
	}
	assert.match(agents, /`do-prepare-pr`/);
	assert.match(ship, /fragment in `\.changeset\/` by hand \(`pnpm changeset` prompts\)/);

	const qualityGate = release.indexOf('run: pnpm check');
	const publishAction = release.search(/uses: changesets\/action@[0-9a-f]{40} # v2\./);
	assert.ok(qualityGate >= 0, 'release workflow must run pnpm check');
	assert.ok(publishAction > qualityGate, 'quality gate must finish before Changesets can publish');
	// The action only opens the version PR: publication and tags belong to the guarded scripts,
	// and v2 pushes tags unless told not to.
	const actionStep = release.slice(publishAction, release.indexOf('\n\n', publishAction));
	assert.doesNotMatch(actionStep, /publish-script:/);
	assert.match(actionStep, /push-git-tags: false/);
	assert.match(actionStep, /create-github-releases: false/);
});

test('publish workflows check the tag against the manifest before publishing', () => {
	const python = read('.github/workflows/publish-python.yml');
	const pythonCheck = python.indexOf('- name: Validate admission and version matches tag');
	assert.ok(pythonCheck >= 0, 'publish-python.yml must validate source identity and tag');
	const pythonCheckStep = python.slice(pythonCheck, python.indexOf('\n  test:', pythonCheck));
	assert.match(pythonCheckStep, /release-native\.py/);
	assert.match(pythonCheckStep, /--unit afd-python --route pypi-tag --tag/);
	assert.doesNotMatch(
		pythonCheckStep,
		/^\s+if:/m,
		'the Python version check must run for tag pushes and GitHub Releases alike'
	);
	assert.match(
		python,
		/if: github\.event_name == 'push' \|\| startsWith\(github\.event\.release\.tag_name, 'python-v'\)/,
		'GitHub Releases for other implementations must not publish Python'
	);
	assert.ok(python.indexOf('uses: pypa/gh-action-pypi-publish@') > pythonCheck);

	const botcore = read('.github/workflows/publish-botcore.yml');
	const botcoreCheck = botcore.indexOf('- name: Validate admission and version matches tag');
	assert.ok(botcoreCheck >= 0, 'publish-botcore.yml must validate source identity and tag');
	const botcoreCheckStep = botcore.slice(botcoreCheck, botcore.indexOf('\n  test:', botcoreCheck));
	assert.match(botcoreCheckStep, /release-native\.py/);
	assert.match(botcoreCheckStep, /--unit botcore --route pypi-botcore --tag/);
	assert.doesNotMatch(
		botcoreCheckStep,
		/^\s+if:/m,
		'the Botcore version check must run for tag pushes and GitHub Releases alike'
	);
	assert.match(
		botcore,
		/if: github\.event_name == 'push' \|\| startsWith\(github\.event\.release\.tag_name, 'botcore-v'\)/,
		'GitHub Releases for other tracks must not publish Botcore'
	);
	const botcoreCi = botcore.indexOf('uses: ./.github/workflows/botcore.yml');
	assert.ok(botcoreCi > botcoreCheck, 'publish-botcore.yml must run botcore.yml first');
	assert.ok(botcore.indexOf('uses: pypa/gh-action-pypi-publish@') > botcoreCi);
	assert.match(read('.github/workflows/botcore.yml'), /^ {2}workflow_call:/m);

	const rust = read('.github/workflows/publish-rust.yml');
	const rustCheck = rust.indexOf('- name: Validate version matches tag');
	const rustCi = rust.indexOf('uses: ./.github/workflows/rust.yml');
	const rustPublish = rust.indexOf('- name: Publish to crates.io');
	assert.ok(rustCheck >= 0, 'publish-rust.yml must compare the tag with Cargo.toml');
	assert.ok(rustCi > rustCheck && rustPublish > rustCi, 'publish-rust.yml must run rust.yml first');
	assert.match(rust, /needs: \[version, check\]/);
	assert.match(read('.github/workflows/rust.yml'), /^ {2}workflow_call:/m);
});

test('npm publication requires durable ownership before upload and completion after finalization', () => {
	const manifest = JSON.parse(read('package.json'));
	const workflow = read('.github/workflows/release.yml');
	assert.equal(manifest.scripts.changeset, 'node scripts/release/changeset.mjs');
	assert.equal(manifest.scripts['version-packages'], 'node scripts/release-control.mjs version');
	assert.equal(manifest.scripts['publish:npm'], 'node scripts/release-control.mjs publish');
	assert.doesNotMatch(workflow, /publish: pnpm publish:npm/);
	assert.match(workflow, /statuses: write/);
	assert.match(workflow, /fetch-depth: 0/);
	// The order within the publishing job; hosts-needed also reads the intent, to build hosts.
	const job = workflow.slice(workflow.indexOf('\n  release:'));
	const inspect = job.indexOf('release-claim.mjs inspect');
	const intent = job.indexOf('release-control.mjs intent-status');
	const acquire = job.indexOf('release-claim.mjs acquire');
	const publish = job.indexOf('run: pnpm publish:npm');
	const finalize = job.indexOf('release-finalize.mjs');
	const complete = job.indexOf('release-claim.mjs complete');
	assert.ok(inspect >= 0 && intent > inspect && acquire > intent);
	assert.ok(publish > acquire && finalize > publish && complete > finalize);
	for (const line of workflow.split('\n').filter((line) => /run:.*release-claim\.mjs/.test(line)))
		assert.match(line, /--output/, 'every claim command needs a persistent output argument');
	assert.match(workflow, /npm-plan\.json\.artifacts\//);
	assert.match(workflow, /registry versions exist without verified finalization/);
});

test('a push to main cannot cancel a recovery dispatch that is waiting', () => {
	const workflow = read('.github/workflows/release.yml');
	// One concurrency group keeps a single pending run, and a newer run replaces it. In the pushes'
	// group, a push therefore cancelled a recovery waiting behind an earlier push's run.
	const group = workflow.match(/^concurrency: (.+)$/m)?.[1];
	assert.equal(
		group,
		"${{ github.workflow }}-${{ github.ref }}${{ github.event_name == 'workflow_dispatch' && '-recovery' || '' }}"
	);
	// A run that is publishing or recovering is never cancelled either.
	assert.doesNotMatch(workflow, /cancel-in-progress/);
	// What the groups no longer serialize, the claim does: a push run reads it before anything it
	// could publish, and only the recovery job reconciles.
	const release = workflow.slice(
		workflow.indexOf('\n  release:'),
		workflow.indexOf('\n  recover:')
	);
	const recover = workflow.slice(workflow.indexOf('\n  recover:'));
	assert.match(release, /if: >-\n\s+github\.event_name == 'push'/);
	assert.ok(
		release.indexOf('release-claim.mjs inspect') < release.indexOf('run: pnpm check:all'),
		'a push run reads the claim before the gate and the upload'
	);
	assert.match(
		recover,
		/if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/
	);
	assert.doesNotMatch(release, /release-recover\.mjs/);
});

test('the release tag token is narrow, late and reaches only the tag push', () => {
	const workflow = read('.github/workflows/release.yml');
	const release = workflow.slice(
		workflow.indexOf('\n  release:'),
		workflow.indexOf('\n  recover:')
	);
	const recover = workflow.slice(workflow.indexOf('\n  recover:'));
	for (const [job, before, pusher] of [
		[release, 'run: pnpm publish:npm', 'node scripts/release-finalize.mjs'],
		[recover, 'run: pnpm check:all', 'node scripts/release-recover.mjs'],
	]) {
		const start = job.indexOf('- name: Create release tag token');
		const push = job.indexOf(pusher);
		assert.ok(job.indexOf(before) >= 0 && start > job.indexOf(before), 'created after the gate');
		assert.ok(push > start, 'created before the tag push');
		const step = job.slice(start, job.indexOf('\n\n', start));
		// A missing or broken App must not hold a release GITHUB_TOKEN could still finish.
		assert.match(step, /continue-on-error: true/);
		assert.match(step, /vars\.RELEASE_TAG_APP_CLIENT_ID != ''/);
		assert.deepEqual(step.match(/permission-[a-z-]+: \w+/g), [
			'permission-contents: write',
			'permission-workflows: write',
		]);
		assert.equal(job.match(/steps\.tag-token\.outputs\.token/g)?.length, 1, 'one step gets it');
		const nextStep = job.indexOf('\n      - ', push);
		const env = job.slice(job.lastIndexOf('\n      - ', push), nextStep);
		assert.match(env, /TAG_TOKEN: \$\{\{ steps\.tag-token\.outputs\.token \}\}/);
		assert.match(env, /GIT_CONFIG_VALUE_0=\n/, 'clears the credential checkout stored');
		assert.match(env, /add-mask::\$credential/);
	}
});

test('an approved Specimen release builds and stages every prebuilt host before packing', () => {
	const workflow = read('.github/workflows/release.yml');
	const platforms = readdirSync(join(repoRoot, 'foundations/specimen/packages'))
		.filter((name) => name.startsWith('host-'))
		.map((name) => name.slice('host-'.length))
		.sort();
	assert.equal(platforms.length, 4);
	const matrix = [...workflow.matchAll(/^ {10}- platform: (\S+)$/gm)].map((match) => match[1]);
	assert.deepEqual([...matrix].sort(), platforms, 'build every platform package and no other');
	const loop = workflow.match(/for platform in ([^;]+); do/);
	assert.deepEqual(loop?.[1].trim().split(/\s+/).sort(), platforms, 'stage every platform');
	const gate = workflow.indexOf('run: pnpm check:all');
	const stage = workflow.indexOf('node foundations/specimen/host/stage.mjs "$platform" --binary');
	const plan = workflow.indexOf('run: pnpm release:plan');
	assert.ok(
		gate >= 0 && stage > gate && plan > stage,
		'stage the hosts after the gate, before packing'
	);
	// Without the hosts the release job still versions; after a failed host build it does not run.
	assert.match(workflow, /needs: \[hosts-needed, specimen-hosts\]/);
	assert.match(
		workflow,
		/contains\(fromJSON\('\["success", "skipped"\]'\), needs\.specimen-hosts\.result\)/
	);
	assert.match(workflow, /status\.selectedUnits\.includes\("specimen"\)/);
	for (const id of ['hosts-needed', 'specimen-hosts']) {
		const job = workflow.slice(workflow.indexOf(`\n  ${id}:`), workflow.indexOf('\n  release:'));
		assert.match(job, /permissions:\n {6}contents: read\n/, `${id} reads only`);
		assert.doesNotMatch(
			job,
			/rust-cache|id-token/,
			`${id} uses no cache and no publishing identity`
		);
	}
});

test('workflow actions are pinned to full commit SHAs', () => {
	const workflowDirectory = '.github/workflows';
	for (const entry of readdirSync(new URL(`../${workflowDirectory}/`, import.meta.url))) {
		if (!/\.ya?ml$/.test(entry)) continue;
		for (const line of read(`${workflowDirectory}/${entry}`).split('\n')) {
			const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
			if (!match || match[1].startsWith('./')) continue;
			assert.match(
				`${match[1]}${match[2]}`,
				/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
				`${entry}: pin "${match[1]}" to a commit SHA with a "# vX.Y.Z" comment`
			);
		}
	}
});

test('agent instruction files fit what every harness loads', () => {
	// The root AGENTS.md loads in every session of every harness, so it carries only what every
	// session needs; detail goes to the skill or document that owns it. 12 KiB is about 200 lines of
	// ordinary length, the size Claude Code's documentation gives as the target for such a file.
	const rootBudget = 12 * 1024;
	// Codex concatenates the AGENTS.md files from the repository root down to its working directory
	// and stops adding files once they reach project_doc_max_bytes, 32 KiB by default, so a nested
	// file has to fit under that together with the files above it.
	const chainLimit = 32 * 1024;

	// A hook exports GIT_DIR and its relatives, which would point this at another repository.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
	);
	const files = execFileSync(
		'git',
		['ls-files', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/AGENTS.md'],
		{ cwd: repoRoot, env, encoding: 'utf8' }
	)
		.split('\n')
		.filter((file) => file && existsSync(join(repoRoot, file)));
	const size = (file) => Buffer.byteLength(read(file));

	assert.ok(files.includes('AGENTS.md'), 'the root AGENTS.md must exist');
	assert.ok(
		size('AGENTS.md') <= rootBudget,
		`AGENTS.md is ${size('AGENTS.md')} bytes, over its ${rootBudget}-byte budget: move detail into the skill or document that owns it and leave a pointer`
	);
	for (const file of files) {
		const directories = file.split('/').slice(0, -1);
		const above = directories
			.map((_, depth) => `${directories.slice(0, depth + 1).join('/')}/AGENTS.md`)
			.filter((path) => path !== file && files.includes(path));
		const chain = file === 'AGENTS.md' ? [file] : ['AGENTS.md', ...above, file];
		const bytes = chain.reduce((total, path) => total + size(path), 0);
		assert.ok(
			bytes <= chainLimit,
			`${chain.join(' + ')} is ${bytes} bytes, over the ${chainLimit} bytes Codex loads: a session started in ${directories.join('/')} would lose instructions`
		);
	}
});

function publishedPackageDirectories() {
	return readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `packages/${entry.name}`)
		.filter((directory) => existsSync(join(repoRoot, directory, 'package.json')))
		.filter((directory) => JSON.parse(read(`${directory}/package.json`)).private !== true);
}

function testFiles(directory, root = directory) {
	const found = [];
	for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
			continue;
		}
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) found.push(...testFiles(path, root));
		else if (/\.test\.tsx?$/.test(entry.name)) found.push(path.slice(root.length + 1));
	}
	return found;
}

test('Health stays a quarantined endpoint with no publication route', async () => {
	const { assertAdmission, loadInventory } = await import('./release/control.mjs');
	const inventory = loadInventory(repoRoot);
	const unit = inventory.units.find((entry) => entry.id === 'health');
	assert.equal(unit.state, 'quarantined');
	assert.deepEqual(
		unit.distributions.map((entry) => [entry.name, entry.manifest]),
		[['lushly-health', 'endpoints/health/pyproject.toml']]
	);
	assert.throws(
		() => assertAdmission({ root: repoRoot, inventory, unit: 'health', route: 'pypi-health' }),
		/not admitted/
	);
	for (const workflow of readdirSync(join(repoRoot, '.github/workflows')))
		if (workflow !== 'health.yml')
			assert.doesNotMatch(
				read(`.github/workflows/${workflow}`),
				/lushly-health|pypi-health|unit health/,
				workflow
			);
	const health = read('.github/workflows/health.yml');
	assert.match(health, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(health, /publish|upload|id-token|secrets\./);
});

test('the Health dashboard is a private, route-less endpoint over FAST-AF and the report contract', async () => {
	const { assertAdmission, discoverDistributions, loadInventory } = await import(
		'./release/control.mjs'
	);
	const { checkBoundaries } = await import('./check-boundaries.mjs');
	const inventory = loadInventory(repoRoot);
	const unit = inventory.units.find((entry) => entry.id === 'health-dashboard');
	assert.equal(unit.state, 'quarantined');
	assert.deepEqual(unit.routes, []);
	assert.deepEqual(
		unit.distributions.map((entry) => [entry.name, entry.manifest, entry.private]),
		[['@lushly-dev/health-dashboard', 'endpoints/health-dashboard/package.json', true]]
	);
	const manifest = JSON.parse(read('endpoints/health-dashboard/package.json'));
	assert.equal(manifest.private, true);
	assert.ok(!discoverDistributions(repoRoot, inventory).some((entry) => entry.unit === unit.id));
	assert.throws(
		() => assertAdmission({ root: repoRoot, inventory, unit: unit.id, route: 'npm-main' }),
		/not admitted/
	);
	// Runtime edges: FAST-AF only; plus the build-time read of Health's report-1.2 schema.
	const { dependencies, errors } = checkBoundaries(repoRoot);
	assert.deepEqual(errors, []);
	assert.deepEqual(dependencies['@lushly-dev/health-dashboard'], [
		'@lushly-dev/fast-element',
		'@lushly-dev/violet-elements',
		'lushly-health',
	]);
	assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
		'@lushly-dev/fast-element',
		'@lushly-dev/violet-elements',
	]);
	// Nothing depends on the dashboard, so Health and its consumers never pull it in.
	for (const [name, targets] of Object.entries(dependencies))
		assert.ok(!targets.includes('@lushly-dev/health-dashboard'), name);
	const health = read('endpoints/health/pyproject.toml');
	assert.match(health, /^dependencies = \[\]$/m);
	const workflow = read('.github/workflows/health-dashboard.yml');
	assert.match(workflow, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(workflow, /publish|deploy|pages|id-token|secrets\./);
});

test('Loam is private, route-less endpoints under endpoints/loam/packages and apps', async () => {
	const { assertAdmission, discoverDistributions, loadInventory } = await import(
		'./release/control.mjs'
	);
	const { checkBoundaries } = await import('./check-boundaries.mjs');
	const inventory = loadInventory(repoRoot);
	const { dependencies, errors } = checkBoundaries(repoRoot);
	assert.deepEqual(errors, []);
	assert.match(read('pnpm-workspace.yaml'), /^ {2}- "endpoints\/loam\/packages\/\*"$/m);
	assert.match(read('pnpm-workspace.yaml'), /^ {2}- "endpoints\/loam\/apps\/\*"$/m);
	const loam = [
		'manifest',
		'sdk',
		'testing',
		'cli',
		'theme',
		'kernel',
		'console',
		'chrome',
		'web',
		'identity',
		'host',
		'app-hello',
		'app-tally',
		'app-tasks',
		'app-notes',
		'app-checklist',
	];
	for (const name of loam) {
		const unit = inventory.units.find((entry) => entry.id === `loam-${name}`);
		assert.equal(unit.family, 'loam');
		assert.equal(unit.state, 'quarantined');
		assert.deepEqual(unit.routes, []);
		assert.deepEqual(unit.gates, ['pnpm check', 'loam.yml', 'release-approval']);
		const manifestPath = name.startsWith('app-')
			? `endpoints/loam/apps/${name.slice('app-'.length)}/package.json`
			: `endpoints/loam/packages/${name}/package.json`;
		assert.deepEqual(
			unit.distributions.map((entry) => [entry.name, entry.manifest, entry.private]),
			[[`@lushly-dev/loam-${name}`, manifestPath, true]]
		);
		assert.equal(JSON.parse(read(manifestPath)).private, true);
		assert.ok(!discoverDistributions(repoRoot, inventory).some((entry) => entry.unit === unit.id));
		assert.throws(
			() => assertAdmission({ root: repoRoot, inventory, unit: unit.id, route: 'npm-main' }),
			/not admitted/
		);
	}
	// Nothing outside Loam depends on it, at runtime or in development.
	const names = new Set(loam.map((name) => `@lushly-dev/loam-${name}`));
	for (const [name, targets] of Object.entries(dependencies))
		if (!names.has(name)) assert.ok(!targets.some((target) => names.has(target)), name);
	// Strip GIT_* so a hook's environment cannot point git at another repository.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	for (const manifestPath of execFileSync('git', ['ls-files', '*package.json'], {
		cwd: repoRoot,
		encoding: 'utf8',
		env,
	})
		.split('\n')
		.filter((path) => path && !path.startsWith('endpoints/loam/'))) {
		const manifest = JSON.parse(read(manifestPath));
		const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
		assert.ok(!declared.some((target) => names.has(target)), manifestPath);
	}
	// The kernel has no DOM or foundation dependency, and of Loam takes only the manifest's catalogs and
	// the SDK's types; the chrome reaches Violet only through FAST-AF's components.
	assert.ok(
		!dependencies['@lushly-dev/loam-kernel'].some((target) =>
			/fast-element|violet|specimen/.test(target)
		)
	);
	assert.deepEqual(
		dependencies['@lushly-dev/loam-kernel'].filter((target) => target.includes('loam-')),
		['@lushly-dev/loam-manifest', '@lushly-dev/loam-sdk']
	);
	assert.deepEqual(dependencies['@lushly-dev/loam-chrome'], [
		'@lushly-dev/fast-element',
		'@lushly-dev/loam-console',
		'@lushly-dev/loam-kernel',
		'@lushly-dev/loam-sdk',
		'@lushly-dev/loam-theme',
		'@lushly-dev/violet-elements',
	]);
	// The console binds to the SDK's client alone (7.7).
	assert.ok(!dependencies['@lushly-dev/loam-console'].includes('@lushly-dev/loam-kernel'));
	const workflow = read('.github/workflows/loam.yml');
	assert.match(workflow, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(workflow, /publish|deploy|pages|id-token|secrets\./);
});

test('a workflow reads the one output its affected.mjs gate writes', () => {
	// `gate` writes only `run=`, so any other key reads as empty and silently skips the job.
	const directory = join(repoRoot, '.github/workflows');
	for (const file of readdirSync(directory)) {
		const workflow = read(`.github/workflows/${file}`);
		for (const [, id] of workflow.matchAll(
			/- id: ([\w-]+)\n\s+run: node scripts\/affected\.mjs gate\b/g
		)) {
			const reads = [...workflow.matchAll(new RegExp(`steps\\.${id}\\.outputs\\.([\\w-]+)`, 'g'))];
			assert.ok(reads.length > 0, `${file}: nothing reads the gate step ${id}`);
			for (const [text, key] of reads) assert.equal(key, 'run', `${file}: ${text}`);
		}
	}
});

test("loam.yml shows the titles Loam phase 2's exit check reads, and a manual run opens every gate", () => {
	// scripts/loam-exit-check.mjs reads a manual run's jobs and log; a skipped job or a hidden title fails it.
	const loam = read('.github/workflows/loam.yml');
	for (const workflow of [loam, read('.github/workflows/ci.yml')]) {
		assert.match(workflow, /^ {2}workflow_dispatch:$/m);
		assert.match(
			workflow,
			/AFD_SCOPE: \$\{\{ \(github\.event_name == 'pull_request' \|\| github\.event_name == 'push'\) && 'affected' \|\| 'all' \}\}/
		);
	}
	// Each job past the gate reads a gate output the scope job sets from a gate step's `run`.
	for (const [job, output] of [
		['loam', 'run'],
		['walk', 'run'],
		['mounted', 'mounted'],
		['hosted', 'run'],
	]) {
		const block = new RegExp(
			`^ {2}${job}:\\n[\\s\\S]*?(?=^ {2}[\\w-]+:\\n|$(?![\\s\\S]))`,
			'm'
		).exec(loam)?.[0];
		assert.ok(block, job);
		assert.match(block, /^ {4}needs: scope$/m, job);
		assert.match(block, new RegExp(`^ {4}if: needs\\.scope\\.outputs\\.${output} == 'true'$`, 'm'));
		assert.match(
			loam,
			new RegExp(`^ {6}${output}: \\$\\{\\{ steps\\.[\\w-]+\\.outputs\\.run \\}\\}$`, 'm')
		);
	}
	assert.match(
		loam,
		/- name: Unit suites with coverage\n {8}run: pnpm -F "\.\/endpoints\/loam\/packages\/\*" -F "\.\/endpoints\/loam\/apps\/\*" test --coverage --reporter=verbose\b/
	);
	assert.ok(
		loam.includes(
			"- name: AFD's lean path\n        run: |\n" +
				'          pnpm -F @lushly-dev/afd-server exec vitest run src/entry-points.test.ts --reporter=verbose --reporter=github-actions\n' +
				'          node --test --test-reporter=spec scripts/plugin-manifest.test.mjs\n'
		)
	);
	// Phase 6's P6-E7 titles, which ci.yml's log cannot show: local-db's SQLite contract, verbose.
	assert.ok(
		loam.includes(
			"- name: AFD's host path\n" +
				'        run: pnpm -F @lushly-dev/local-db exec vitest run src/sqlite-adapter.test.ts src/entry.test.ts --reporter=verbose --reporter=github-actions\n'
		)
	);
	// test:browser chains two runs, so a flag would reach only the last: each config names the reporter.
	for (const config of ['browser', 'conformance', 'mounted', 'walk', 'hosted'])
		assert.match(
			read(`endpoints/loam/packages/web/vitest.${config}.config.ts`),
			/^\t\treporters: process\.env\.GITHUB_ACTIONS === 'true' \? \['verbose', 'github-actions'\] : \['verbose'\],$/m,
			config
		);
	assert.match(read('packages/server/src/entry-points.test.ts'), /'P2-E2: /);
	assert.match(read('scripts/plugin-manifest.test.mjs'), /test\("P2-E11: /);
});

test("Loam's exit tests cannot pass by retry, expected failure, skip, todo or only", () => {
	// Vitest prints a test that passed on a retry, or an `it.fails` that failed, as a plain pass, so the
	// exit check (scripts/loam-exit-check.mjs) cannot see them in a log: the tests its rows read hold none.
	const files = [
		...execFileSync(
			'git',
			[
				'ls-files',
				'endpoints/loam/packages/*.test.ts',
				'endpoints/loam/apps/*.test.ts',
				'endpoints/loam/packages/*/vitest*.config.ts',
				'endpoints/loam/apps/*/vitest*.config.ts',
			],
			{ cwd: repoRoot, encoding: 'utf8' }
		)
			.split('\n')
			.filter(Boolean),
		'packages/server/src/entry-points.test.ts',
		'packages/server/vitest.config.ts',
		'scripts/plugin-manifest.test.mjs',
	];
	assert.ok(files.length > 100, `${files.length} files`);
	const refused = [
		// it.skip, test.only, describe.todo, it.fails, describe.skipIf, it.runIf, and their chains.
		/\b(?:it|test|describe|suite|bench)(?:\.\w+)*\.(?:skip|only|todo|fails|skipIf|runIf)\b/,
		// A test's own context, in Vitest or node: `ctx.skip()`, `t.todo()`.
		/\b(?:ctx|context|t|task)\.(?:skip|todo)\s*\(/,
		/\bexpectFailure\b/,
		// Vitest's `retry` option, in a config or a test's options.
		/\bretry\s*:/,
		// node's options: `{ skip: true }`, `{ todo: 'later' }`, `{ only: true }`.
		/\{\s*(?:skip|todo|only)\s*:/,
	];
	const found = [];
	for (const file of files) {
		const lines = read(file).split('\n');
		lines.forEach((line, index) => {
			for (const pattern of refused)
				if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(found, []);
});

test('Umbel is a private, route-less endpoint over the afd crate', async () => {
	const { assertAdmission, discoverDistributions, loadInventory } = await import(
		'./release/control.mjs'
	);
	const inventory = loadInventory(repoRoot);
	const unit = inventory.units.find((entry) => entry.id === 'umbel');
	assert.equal(unit.state, 'quarantined');
	assert.deepEqual(unit.routes, []);
	assert.deepEqual(
		unit.distributions.map((entry) => [entry.name, entry.manifest, entry.format, entry.private]),
		[['umbel', 'endpoints/umbel/Cargo.toml', 'rust', true]]
	);
	assert.ok(!discoverDistributions(repoRoot, inventory).some((entry) => entry.unit === unit.id));
	for (const route of ['crates-tag', 'npm-main'])
		assert.throws(
			() => assertAdmission({ root: repoRoot, inventory, unit: unit.id, route }),
			/not admitted|route/,
			route
		);
	const architecture = JSON.parse(read('architecture.json'));
	const boundary = architecture.units.find(
		(entry) => entry.manifest === 'endpoints/umbel/Cargo.toml'
	);
	assert.equal(boundary.family, 'umbel');
	assert.equal(boundary.layer, 'endpoint');
	assert.deepEqual(boundary.publicSurfaces, [
		'rust-library',
		'bin:umbel',
		'umbel serve --stdio',
		'umbel serve --http',
		'workspace-config-1',
		'workspace-config-2',
		'plugin-manifest-1',
		'pack-manifest-1',
		'plugin-protocol-1',
		'wit:umbel:plugin@1.0.0',
		'principal-0',
		'provenance-envelope-0',
		'event-0',
		'cursor-0',
	]);
	const manifest = read('endpoints/umbel/Cargo.toml');
	assert.match(manifest, /^publish = false$/m);
	assert.match(manifest, /^afd = \{ path = "\.\.\/\.\.\/packages\/rust"/m);
	assert.match(read('.gitignore'), /^!endpoints\/umbel\/Cargo\.lock$/m);
	// Loam's `mounted` job runs against a stock `umbel` (Loam D64): its filters, its gate and its build, only.
	const loamMounted = [
		"- 'endpoints/umbel/**'",
		"- '!endpoints/umbel/docs/**'",
		'--path endpoints/umbel/ ',
		'--except endpoints/umbel/docs/ ',
		'working-directory: endpoints/umbel',
		'workspaces: endpoints/umbel',
	];
	for (const workflow of readdirSync(join(repoRoot, '.github/workflows'))) {
		if (workflow === 'umbel.yml') continue;
		let text = read(`.github/workflows/${workflow}`);
		if (workflow === 'loam.yml') {
			for (const allowed of loamMounted) {
				assert.ok(text.includes(allowed), `loam.yml has lost ${allowed}`);
				text = text.replaceAll(allowed, '');
			}
		}
		assert.doesNotMatch(text, /endpoints\/umbel|unit umbel/, workflow);
	}
	const umbel = read('.github/workflows/umbel.yml');
	assert.match(umbel, /permissions:\n {2}contents: read/);
	// The knowledge job uploads its eval report as a workflow artifact; that is not publication.
	assert.doesNotMatch(umbel, /publish|upload(?!-artifact)|id-token|secrets\./);
	assert.match(umbel, /actions\/upload-artifact@[0-9a-f]{40} # v/);
});

test("Mail's engine is a private, route-less Loam plugin outside Loam's workflow", async () => {
	const { loadInventory } = await import('./release/control.mjs');
	const manifestPath = 'endpoints/loam/plugins/mail/engine/Cargo.toml';
	const unit = loadInventory(repoRoot).units.find((entry) => entry.id === 'loam-mail');
	assert.equal(unit.state, 'quarantined');
	assert.deepEqual(unit.routes, []);
	assert.deepEqual(unit.gates, ['loam-plugins.yml', 'release-approval']);
	assert.deepEqual(
		unit.distributions.map((entry) => [entry.name, entry.manifest, entry.format, entry.private]),
		[['loam_mail', manifestPath, 'rust', true]]
	);
	const boundary = JSON.parse(read('architecture.json')).units.find(
		(entry) => entry.manifest === manifestPath
	);
	assert.equal(boundary.family, 'loam');
	assert.equal(boundary.layer, 'endpoint');
	const manifest = read(manifestPath);
	assert.match(manifest, /^publish = false$/m);
	assert.match(manifest, /^afd = \{ path = "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/rust"/m);
	// The engine is a binary: its lock is committed so CI builds what it tested.
	assert.match(read('.gitignore'), /^!endpoints\/loam\/plugins\/mail\/engine\/Cargo\.lock$/m);
	// Loam's D109: a plugin is outside Loam's workflow, on push and on pull request.
	const loam = read('.github/workflows/loam.yml');
	assert.equal(loam.split("- '!endpoints/loam/plugins/**'").length - 1, 2);
	const plugins = read('.github/workflows/loam-plugins.yml');
	assert.match(plugins, /permissions:\n {2}contents: read/);
	assert.doesNotMatch(plugins, /publish|upload|id-token|secrets\./);
	assert.equal(plugins.split("- '!endpoints/loam/plugins/*/docs/**'").length - 1, 2);
});

test("Umbel's test identity provider is a private, route-less, test-only unit", async () => {
	const { assertAdmission, discoverDistributions, loadInventory } = await import(
		'./release/control.mjs'
	);
	const inventory = loadInventory(repoRoot);
	const unit = inventory.units.find((entry) => entry.id === 'umbel-testkit-idp');
	assert.equal(unit.state, 'quarantined');
	assert.deepEqual(unit.routes, []);
	assert.deepEqual(
		unit.distributions.map((entry) => [entry.name, entry.manifest, entry.format, entry.private]),
		[['umbel-testkit-idp', 'endpoints/umbel/testkit-idp/Cargo.toml', 'rust', true]]
	);
	assert.ok(!discoverDistributions(repoRoot, inventory).some((entry) => entry.unit === unit.id));
	for (const route of ['crates-tag', 'npm-main'])
		assert.throws(
			() => assertAdmission({ root: repoRoot, inventory, unit: unit.id, route }),
			/not admitted|route/,
			route
		);
	const manifest = read('endpoints/umbel/testkit-idp/Cargo.toml');
	assert.match(manifest, /^publish = false$/m);
	assert.doesNotMatch(manifest, /^\[\[bin\]\]/m);
	// Phase 5 specification, section 1: the host names it only as a dev-dependency
	// (`tests/no_auth_server.rs` checks every workspace crate through `cargo metadata`).
	const sections = read('endpoints/umbel/Cargo.toml').split(/\n(?=\[)/);
	const linked = sections.filter((section) =>
		/^\[(dependencies|build-dependencies|target\.[^\]]+\.(dependencies|build-dependencies))(\.[^\]]+)?\]/.test(
			section
		)
	);
	assert.ok(linked.some((section) => section.startsWith('[dependencies]')));
	for (const section of linked) assert.doesNotMatch(section, /testkit-idp/);
});

test('every published package type-checks its tests', () => {
	const packages = publishedPackageDirectories();
	assert.ok(packages.includes('packages/core'), 'expected to find the published packages');

	for (const directory of packages) {
		const manifest = JSON.parse(read(`${directory}/package.json`));
		assert.equal(
			manifest.scripts?.typecheck,
			'tsc -p tsconfig.typecheck.json',
			`${directory} needs a test-inclusive typecheck script`
		);

		const config = JSON.parse(read(`${directory}/tsconfig.typecheck.json`));
		assert.equal(config.extends, './tsconfig.json', `${directory}/tsconfig.typecheck.json`);
		assert.equal(config.compilerOptions?.noEmit, true, `${directory}/tsconfig.typecheck.json`);
		for (const pattern of config.exclude ?? []) {
			assert.doesNotMatch(pattern, /test/, `${directory}/tsconfig.typecheck.json excludes tests`);
		}

		const roots = (config.include ?? [])
			.filter((pattern) => pattern.endsWith('/**/*'))
			.map((pattern) => pattern.slice(0, -'**/*'.length));
		for (const file of testFiles(directory)) {
			assert.ok(
				roots.some((root) => file.startsWith(root)),
				`${directory}/${file} is outside tsconfig.typecheck.json's include`
			);
		}
	}
});

test('every published package enforces coverage thresholds', () => {
	for (const directory of publishedPackageDirectories()) {
		const configPath = `${directory}/vitest.config.ts`;
		assert.ok(existsSync(join(repoRoot, configPath)), `${directory} needs a vitest.config.ts`);
		const config = read(configPath);

		assert.doesNotMatch(config, /globals:\s*true/, `${configPath} must use explicit imports`);
		assert.match(config, /include:\s*\[\s*'src\/\*\*\/\*\.ts'\s*\]/, `${configPath} coverage`);
		const thresholds = config.match(/thresholds:\s*\{([^}]*)\}/)?.[1];
		assert.ok(thresholds, `${configPath} needs coverage thresholds`);
		for (const metric of ['statements', 'branches', 'functions', 'lines']) {
			assert.match(thresholds, new RegExp(`${metric}:\\s*[1-9]\\d*`), `${configPath} ${metric}`);
		}
	}
});

test('public TypeScript example commands explicitly opt in to MCP', () => {
	const commandDirectories = [
		'packages/examples/todo/backends/typescript/src/commands',
		'packages/examples/todo-directclient/backend/src/commands',
		'packages/examples/chat/src/commands',
	];

	for (const directory of commandDirectories) {
		for (const entry of readdirSync(new URL(`../${directory}/`, import.meta.url))) {
			if (!entry.endsWith('.ts') || entry === 'index.ts' || entry.endsWith('.test.ts')) continue;
			const source = read(`${directory}/${entry}`);
			if (!source.includes('defineCommand')) continue;
			assert.match(source, /expose:\s*\{\s*mcp:\s*true\s*\}/, `${directory}/${entry}`);
		}
	}
});

test('Todo scripts and copied command examples reference real entry points', () => {
	const manifest = JSON.parse(read('packages/examples/todo/package.json'));
	const readme = read('packages/examples/todo/README.md');
	const pythonReadme = read('packages/examples/todo/backends/python/README.md');

	assert.match(
		manifest.scripts['test:conformance:ts'],
		/pnpm --dir backends\/typescript build && tsx dx\/run-conformance\.ts --backend ts/
	);
	assert.match(manifest.scripts['test:conformance:py'], /--backend py/);
	assert.match(manifest.scripts['dev:py'], /uv run --project backends\/python todo-server/);
	assert.equal(manifest.scripts['dev:desktop'], undefined);
	assert.equal(manifest.scripts['build:desktop'], undefined);
	assert.doesNotMatch(readme, /dx\/run-conformance\.ts (ts|py)|afd batch 'todo-/);
	assert.doesNotMatch(pythonReadme, /requirements\.txt|python server\.py/);
});

test('auth built package keeps the core entrypoint free of optional peers', () => {
	const authManifest = JSON.parse(read('packages/auth/package.json'));
	for (const peer of Object.keys(authManifest.peerDependencies)) {
		assert.equal(
			authManifest.peerDependenciesMeta?.[peer]?.optional,
			true,
			`${peer} must remain an optional peer dependency`
		);
	}

	ensureBuilt('packages/core', ['index.js']);
	ensureBuilt('packages/auth', ['index.js', 'react.js', 'commands.js']);

	const consumerRoot = mkdtempSync(join(tmpdir(), 'afd-auth-core-consumer-'));
	try {
		copyBuiltPackage('packages/core', consumerRoot);
		copyBuiltPackage('packages/auth', consumerRoot);
		runConsumer(
			consumerRoot,
			`import assert from 'node:assert/strict';

const auth = await import('@lushly-dev/afd-auth');
assert.equal(typeof auth.MockAuthAdapter, 'function');
assert.equal(typeof auth.BetterAuthAdapter, 'function');
assert.equal(typeof auth.createAuthMiddleware, 'function');
assert.equal(typeof auth.SessionSync, 'function');
assert.equal(auth.createAuthCommands, undefined);
assert.equal(auth.useConvexAuthAdapter, undefined);
`
		);
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
});

test('auth integration subpaths resolve when their peers are installed', () => {
	ensureBuilt('packages/core', ['index.js']);
	ensureBuilt('packages/server', ['index.js', 'define.js']);
	ensureBuilt('packages/auth', ['index.js', 'react.js', 'commands.js']);

	const consumerRoot = mkdtempSync(join(tmpdir(), 'afd-auth-integration-consumer-'));
	try {
		copyBuiltPackage('packages/core', consumerRoot);
		copyBuiltPackage('packages/auth', consumerRoot);
		linkPeer(consumerRoot, '@lushly-dev/afd-server', join(repoRoot, 'packages/server'));
		linkPeer(consumerRoot, 'react', join(repoRoot, 'packages/auth/node_modules/react'));
		linkPeer(consumerRoot, 'zod', join(repoRoot, 'packages/auth/node_modules/zod'));
		runConsumer(
			consumerRoot,
			`import assert from 'node:assert/strict';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';

const react = await import('@lushly-dev/afd-auth/react');
assert.equal(typeof react.createAuthHooks, 'function');
assert.equal(typeof react.useConvexAuthAdapter, 'function');
const hooks = react.createAuthHooks(new MockAuthAdapter());
assert.equal(typeof hooks.useSession, 'function');

const commands = await import('@lushly-dev/afd-auth/commands');
assert.equal(typeof commands.createAuthCommands, 'function');
assert.deepEqual(
	commands.createAuthCommands(new MockAuthAdapter()).map((command) => command.name),
	['auth-sign-in', 'auth-sign-out', 'auth-session-get'],
);
`
		);
	} finally {
		rmSync(consumerRoot, { recursive: true, force: true });
	}
});

#!/usr/bin/env node

/**
 * Release script — bump all @lushly-dev/* packages, update CHANGELOG, commit, tag.
 *
 * Usage:
 *   node scripts/release.mjs patch     # 0.3.0 → 0.3.1
 *   node scripts/release.mjs minor     # 0.3.0 → 0.4.0
 *   node scripts/release.mjs major     # 0.3.0 → 1.0.0
 *   node scripts/release.mjs 0.4.0     # explicit version
 *   node scripts/release.mjs --dry-run # preview without changes
 *
 * All @lushly-dev/* packages share one version (fixed versioning).
 * The root package.json is also bumped for monorepo consistency.
 *
 * After running: `git push origin main --tags` to trigger the Release workflow.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// ─── Parse arguments ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--'));

if (!bump) {
	console.error('Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--dry-run]');
	process.exit(1);
}

// ─── Preflight checks ──────────────────────────────────────────────────────

function run(cmd, opts = {}) {
	return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim();
}

const branch = run('git branch --show-current');
if (branch !== 'main') {
	console.error(`❌ Must be on main branch (current: ${branch})`);
	process.exit(1);
}

const status = run('git status --porcelain');
if (status && !dryRun) {
	console.error('❌ Working tree is not clean. Commit or stash changes first.');
	console.error(status);
	process.exit(1);
}

// Pull latest
if (!dryRun) {
	console.log('📥 Pulling latest from origin...');
	run('git pull origin main');
}

// ─── Version calculation ────────────────────────────────────────────────────

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const currentVersion = rootPkg.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

let newVersion;
if (bump === 'patch') newVersion = `${major}.${minor}.${patch + 1}`;
else if (bump === 'minor') newVersion = `${major}.${minor + 1}.0`;
else if (bump === 'major') newVersion = `${major + 1}.0.0`;
else if (/^\d+\.\d+\.\d+/.test(bump)) newVersion = bump;
else {
	console.error(`❌ Invalid bump: "${bump}". Use patch, minor, major, or X.Y.Z`);
	process.exit(1);
}

console.log(`\n📦 Release: ${currentVersion} → ${newVersion}${dryRun ? ' (dry run)' : ''}\n`);

// ─── Find all packages ─────────────────────────────────────────────────────

function findPackages() {
	const packages = [join(ROOT, 'package.json')];

	// Read pnpm workspace config
	const workspaceFile = join(ROOT, 'pnpm-workspace.yaml');
	if (existsSync(workspaceFile)) {
		const content = readFileSync(workspaceFile, 'utf-8');
		const patterns =
			content
				.match(/- ['"]?([^'"}\n]+)['"]?/g)
				?.map((m) => m.replace(/- ['"]?/, '').replace(/['"]$/, '')) ?? [];

		for (const pattern of patterns) {
			const dir = pattern.replace('/**', '').replace('/*', '');
			try {
				const entries = readdirSync(resolve(ROOT, dir), { withFileTypes: true, recursive: true })
					.filter((e) => e.name === 'package.json' && !e.parentPath.includes('node_modules'))
					.map((e) => resolve(e.parentPath, e.name));
				packages.push(...entries);
			} catch {
				// Directory may not exist
			}
		}
	}

	return packages;
}

const allPackages = findPackages();
const lushlyPackages = [];
const otherPackages = [];

for (const pkgPath of allPackages) {
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
		if (pkg.name?.startsWith('@lushly-dev/') || pkgPath === join(ROOT, 'package.json')) {
			lushlyPackages.push({ path: pkgPath, pkg });
		} else {
			otherPackages.push({ path: pkgPath, pkg });
		}
	} catch {
		// Skip unreadable
	}
}

console.log(`  Packages to bump (${lushlyPackages.length}):`);
for (const { pkg } of lushlyPackages) {
	console.log(`    ${pkg.name}: ${pkg.version} → ${newVersion}`);
}

if (dryRun) {
	console.log('\n🏁 Dry run complete. No files changed.');
	process.exit(0);
}

// ─── Bump versions ──────────────────────────────────────────────────────────

for (const { path: pkgPath, pkg } of lushlyPackages) {
	const content = readFileSync(pkgPath, 'utf-8');
	const updated = content.replace(`"version": "${pkg.version}"`, `"version": "${newVersion}"`);
	writeFileSync(pkgPath, updated);
	console.log(`  ✓ ${pkg.name}`);
}

// ─── Update CHANGELOG ───────────────────────────────────────────────────────

const changelogPath = join(ROOT, 'CHANGELOG.md');
if (existsSync(changelogPath)) {
	const changelog = readFileSync(changelogPath, 'utf-8');
	const today = new Date().toISOString().split('T')[0];
	const updated = changelog.replace(
		'## [Unreleased]',
		`## [Unreleased]\n\n## [${newVersion}] - ${today}`
	);
	writeFileSync(changelogPath, updated);
	console.log(`  ✓ CHANGELOG.md`);
}

// ─── Quality gate ───────────────────────────────────────────────────────────

console.log('\n🔍 Running quality gate...');
try {
	execSync('pnpm check', { cwd: ROOT, stdio: 'inherit' });
} catch {
	console.error('\n❌ Quality gate failed. Fix issues before releasing.');
	process.exit(1);
}

// ─── Commit + Tag ───────────────────────────────────────────────────────────

console.log('\n📝 Committing...');
run('git add -A');
run(`git commit -m "chore: release v${newVersion}" --no-verify`);
run(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

console.log(`\n✅ Release v${newVersion} ready!`);
console.log(`\n  Push to trigger publish:`);
console.log(`    git push origin main --tags`);
console.log(`\n  Or publish locally:`);
console.log(`    pnpm publish:npm`);

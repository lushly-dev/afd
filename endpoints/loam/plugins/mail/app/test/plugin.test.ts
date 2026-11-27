/**
 * Validates `endpoints/loam/plugins/mail/loam-plugin.toml` through `loam plugin check` and
 * `loam plugin pack` (both directory bundle and `.loam-plugin` archive), and verifies its
 * declarative mount policy stays in step with `mount/loam-app.toml` and `app/loam-app.toml`.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	appPack,
	PLUGIN_ARCHIVE_EXTENSION,
	pluginCheck,
	pluginPack,
	readAppManifest,
} from '@lushly-dev/loam-cli';
import { afterEach, describe, expect, it } from 'vitest';

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIL_ROOT = join(APP_ROOT, '..');
const MOUNT_ROOT = join(MAIL_ROOT, 'mount');
const PLUGIN_TOML = join(MAIL_ROOT, 'loam-plugin.toml');

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const scratchDirs: string[] = [];

afterEach(async () => {
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) await rm(dir, { recursive: true, force: true });
	}
});

describe('mail loam-plugin.toml', () => {
	it('passes loam plugin check and packs cleanly to a directory bundle and .loam-plugin archive', async () => {
		const scratch = await mkdtemp(join(tmpdir(), 'loam-mail-plugin-test-'));
		scratchDirs.push(scratch);

		const sourceDir = join(scratch, 'source');
		await mkdir(sourceDir, { recursive: true });

		// Pack the real mount package (`mount/loam-app.toml`) into `apps/mail`.
		const packedMount = await appPack({ dir: MOUNT_ROOT, out: join(sourceDir, 'apps', 'mail') });
		expect(packedMount.report.refusals).toEqual([]);

		// Pack the real native mailapp (`app/loam-app.toml`) into `apps/mailapp`.
		// When `dist/native.js` is built (as in CI and `pnpm check`), require zero refusals.
		// Only when running tests before a build (`!dist/native.js`) allow `ENTRY_NOT_BUILT`
		// and never mask token-lint or manifest refusals.
		const packedApp = await appPack({ dir: APP_ROOT, out: join(sourceDir, 'apps', 'mailapp') });
		if (existsSync(join(APP_ROOT, 'dist', 'native.js'))) {
			expect(packedApp.report.refusals).toEqual([]);
		} else if (packedApp.report.refusals.length > 0) {
			expect(
				packedApp.report.refusals.every((refusal) => refusal.code === 'ENTRY_NOT_BUILT'),
				`unexpected appPack refusals: ${JSON.stringify(packedApp.report.refusals)}`
			).toBe(true);
			const manifest = await readAppManifest(APP_ROOT);
			const appOut = join(sourceDir, 'apps', 'mailapp');
			await mkdir(join(appOut, 'dist'), { recursive: true });
			await writeFile(
				join(appOut, 'app-manifest.json'),
				`${JSON.stringify(manifest, null, '\t')}\n`
			);
			await writeFile(join(appOut, 'dist', 'native.js'), 'export default {};\n');
		}

		// Stage a fixture engine binary matching the supported artifact declared in `loam-plugin.toml`.
		const rawToml = await readFile(PLUGIN_TOML, 'utf8');
		const placeholderDigest = '0'.repeat(64);
		const fixtureBytes = Buffer.from('#!/bin/sh\necho loam-mail 0.1.0\n');
		const fixtureDigest = sha256(fixtureBytes);
		const stagedToml = rawToml.replaceAll(placeholderDigest, fixtureDigest);
		await writeFile(join(sourceDir, 'loam-plugin.toml'), stagedToml);

		const full = join(sourceDir, 'engines', 'darwin-arm64', 'loam-mail');
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, fixtureBytes);
		await chmod(full, 0o755);

		// 1. Check the staged plugin source.
		const checked = await pluginCheck({ dir: sourceDir });
		expect(checked.refusals).toEqual([]);
		expect(checked.ok).toBe(true);
		expect(checked.form).toBe('source');
		expect(checked.manifest?.plugin.id).toBe('mail');
		expect(checked.manifest?.engine?.auth.mode).toBe('approver');
		expect(checked.manifest?.engine?.mount?.approvals).toBe('shell');
		expect(checked.manifest?.engine?.mount?.labels).toBe('per-part');

		// 2. Verify every declared command override exists in `mount/loam-app.toml` and every
		//    `mailapp` `[[calls]]` command is exposed to `apps`.
		const mountManifest = await readAppManifest(MOUNT_ROOT);
		const appManifest = await readAppManifest(APP_ROOT);
		const mountTools = new Set((mountManifest.mount?.tools ?? []).map(({ tool }) => tool));
		const commands = checked.manifest?.engine?.mount?.commands ?? {};
		for (const [cmd, override] of Object.entries(commands)) {
			expect(mountTools.has(cmd), `command ${cmd} missing from mount/loam-app.toml`).toBe(true);
			if (override?.preview) {
				expect(
					mountTools.has(override.preview.command),
					`preview ${override.preview.command} missing from mount/loam-app.toml`
				).toBe(true);
			}
		}
		for (const call of appManifest.calls ?? []) {
			if (call.app === 'mail') {
				for (const cmd of call.commands) {
					expect(
						commands[cmd]?.expose?.apps,
						`mailapp call ${cmd} must have expose.apps = true in loam-plugin.toml`
					).toBe(true);
				}
			}
		}

		// 3. Pack to a directory bundle and re-check.
		const bundleDir = join(scratch, 'mail-bundle');
		const packedDir = await pluginPack({ dir: sourceDir, out: bundleDir });
		expect(packedDir.report.refusals).toEqual([]);
		expect(packedDir.bundleSha256).toBe(checked.bundleSha256);

		const recheckedDir = await pluginCheck({ dir: bundleDir });
		expect(recheckedDir.refusals).toEqual([]);
		expect(recheckedDir.form).toBe('bundle');
		expect(recheckedDir.bundleSha256).toBe(checked.bundleSha256);

		// 4. Pack to a `.loam-plugin` zip archive and re-check to the exact same digest.
		const archivePath = join(scratch, `mail${PLUGIN_ARCHIVE_EXTENSION}`);
		const packedArchive = await pluginPack({ dir: sourceDir, out: archivePath });
		expect(packedArchive.report.refusals).toEqual([]);
		expect(packedArchive.bundleSha256).toBe(checked.bundleSha256);

		const recheckedArchive = await pluginCheck({ dir: archivePath });
		expect(recheckedArchive.refusals).toEqual([]);
		expect(recheckedArchive.form).toBe('archive');
		expect(recheckedArchive.bundleSha256).toBe(checked.bundleSha256);
	});
});

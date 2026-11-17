#!/usr/bin/env node
/**
 * The bundled empty shell (phase 6 specification, 10.2): `web`'s `dist` written by `loam deployment write
 * --host desktop` from a deployment with no app, into `dist/`, which the app embeds and serves when
 * `<app data>/site` has none. Run after `web` is built and before the app is.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';

const here = fileURLToPath(new URL('..', import.meta.url));
const config = join(await mkdtemp(join(tmpdir(), 'loam-desktop-site-')), 'loam.deployment.toml');
await writeFile(
	config,
	[
		'deployment_version = 4',
		'',
		'[host]',
		'kind = "desktop"',
		'',
		'[identity]',
		'mode = "local"',
		'',
		'[apps]',
		'',
	].join('\n')
);
const out = join(here, 'dist');
// A placeholder `cargo` wrote is not `deployment write`'s, so it is replaced, not refused.
await rm(out, { recursive: true, force: true });
const written = await writeDeployment({
	config,
	dist: fileURLToPath(new URL('../../web/dist', import.meta.url)),
	out,
	host: 'desktop',
});
await rm(join(config, '..'), { recursive: true, force: true });
if (!written.ok) {
	console.error(JSON.stringify(written.refusals, null, 2));
	process.exit(1);
}
console.log(`The empty shell is in ${out}`);

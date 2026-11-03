/**
 * P2-E10: no location, credential or command line reaches the kernel's store or journal (phase 2
 * specification, 4.1; D56, D63). From a deployment file that holds a real URL, a token and a command
 * line, through `loam deployment write`'s projection, into a kernel whose stage B applies it: every
 * value written to the store, and every journal entry, is scanned for each. Its Chromium part, the
 * browser's files, is step 7's.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { MemoryJournalSink } from '@lushly-dev/afd-core';
import { writeDeployment } from '@lushly-dev/loam-cli/deployment';
import { createKernel } from '@lushly-dev/loam-kernel';
import { createFixedEnvironment, createFixturePorts } from '@lushly-dev/loam-kernel/testing';
import { readProjection } from '@lushly-dev/loam-manifest/validate';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import { afterEach, describe, expect, it } from 'vitest';

const URL_SECRET = 'http://127.0.0.1:7410/mcp-secret-path';
const TOKEN = 'token-that-must-stay-out-of-every-store';
const COMMAND_SECRET = '/srv/notes-umbel-secret';
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'";

const DEPLOYMENT = `deployment_version = 1

[apps.work]
app = "umbel"
package = "umbel"
prefix = "work"
audience = "team"
transport = "http"
url = "${URL_SECRET}"
bearer_file = "keys/http.token"
projects = ["atlas"]

[apps.home]
app = "umbel"
package = "umbel"
prefix = "home"
audience = "person"
transport = "stdio"
command = ["umbel", "--workspace", "${COMMAND_SECRET}", "serve", "--stdio"]
`;

const MOUNTED = {
	manifest_version: 1,
	protocol: 1,
	plugin: {
		id: 'umbel',
		title: 'Umbel',
		version: '0.1.0',
		description: 'A mounted host, for this test.',
		kind: 'mounted',
		domains: ['umbel'],
	},
	mount: { prefix: 'umbel', transport: 'http' },
};

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function put(root: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), text);
}

/** Every argument any method of `store` was called with, as JSON: what was written to it, and asked of it. */
function recording(store: DataAdapter): { adapter: DataAdapter; written: string[] } {
	const written: string[] = [];
	const adapter = new Proxy(store, {
		get(target, key, receiver) {
			const value = Reflect.get(target, key, receiver);
			if (typeof value !== 'function') return value;
			return (...args: unknown[]) => {
				written.push(JSON.stringify(args));
				return value.apply(target, args);
			};
		},
	});
	return { adapter, written };
}

describe('P2-E10: a deployment file into the stores', () => {
	it('keeps no location, credential or command line in the store or the journal', async () => {
		const root = await mkdtemp(join(tmpdir(), 'loam-secrets-'));
		roots.push(root);
		await put(root, 'deploy/loam.deployment.toml', DEPLOYMENT);
		await put(root, 'deploy/keys/http.token', TOKEN);
		await put(root, 'deploy/umbel/app-manifest.json', JSON.stringify(MOUNTED));
		await put(
			root,
			'dist/index.html',
			`<!doctype html>\n<html><head>\n<meta\n\thttp-equiv="Content-Security-Policy"\n\tcontent="${CSP}"\n/>\n</head></html>`
		);
		await put(
			root,
			'dist/deployment.json',
			'{"deployment_version":2,"generation":"empty","workspace":{"id":"personal","name":"Personal"},"sandbox_origin":null,"apps":[]}'
		);
		const out = join(root, 'out');
		const written = await writeDeployment({
			config: join(root, 'deploy/loam.deployment.toml'),
			dist: join(root, 'dist'),
			out,
			mountsOut: join(root, 'mounts.json'),
		});
		expect(written.ok).toBe(true);
		// The deployer's file did hold them: the scan below looks for what was there.
		expect(DEPLOYMENT).toContain(URL_SECRET);
		expect(DEPLOYMENT).toContain(COMMAND_SECRET);
		const read = readProjection(JSON.parse(await readFile(join(out, 'deployment.json'), 'utf8')));
		if (!read.ok) throw new Error('The projection did not read');
		const { adapter, written: stored } = recording(new MemoryAdapter());
		const journal = new MemoryJournalSink();
		const kernel = await createKernel({
			store: adapter,
			storeKind: 'memory',
			journal,
			auth: new MockAuthAdapter(),
			environment: createFixedEnvironment(),
			host: 'test',
			deployment: read.projection,
			ports: createFixturePorts({
				'apps/work/': { manifest: MOUNTED },
				'apps/home/': { manifest: MOUNTED },
			}),
		});
		await kernel.call('project-create', { name: 'Atlas' });
		await kernel.flush();
		const entries = JSON.stringify(await journal.read());
		await kernel.dispose();
		// The entries were applied, so the scan is of a store that holds them.
		expect(entries).toContain('workspace-deployment-apply');
		expect(stored.join('\n')).toContain('mounts/work/mcp');
		for (const secret of [URL_SECRET, TOKEN, COMMAND_SECRET, 'keys/http.token']) {
			expect(stored.join('\n'), secret).not.toContain(secret);
			expect(entries, secret).not.toContain(secret);
		}
	});
});

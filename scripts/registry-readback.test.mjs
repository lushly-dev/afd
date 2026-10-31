import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readRegistryArtifact } from './release-operations/registry-readback.mjs';

const bytes = Buffer.from('original approved tarball bytes');
const artifact = {
	name: '@fixture/package',
	version: '1.2.3',
	artifactHash: createHash('sha256').update(bytes).digest('hex'),
	size: bytes.length,
};
test('canonical registry blob proves exact approved bytes without package metadata', async () => {
	let requested = 0;
	const result = await readRegistryArtifact(artifact, {
		request: async (url, options) => {
			requested++;
			assert.equal(url.origin, 'https://registry.npmjs.org');
			assert.equal(decodeURIComponent(url.pathname), '/@fixture/package/-/package-1.2.3.tgz');
			assert.ok(options.signal instanceof AbortSignal);
			return new Response(bytes);
		},
	});
	assert.equal(requested, 1);
	assert.equal(result.method, 'registry-tarball');
	assert.equal(result.sha256, artifact.artifactHash);
	assert.equal(result.name, artifact.name);
	assert.equal(result.version, artifact.version);
	assert.equal(result.integrity, `sha512-${createHash('sha512').update(bytes).digest('base64')}`);
});
test('only missing blobs retry; HTTP, size and digest uncertainty reject', async () => {
	assert.deepEqual(
		await readRegistryArtifact(artifact, {
			request: async () => new Response(null, { status: 404 }),
		}),
		{ notVisible: true }
	);
	await assert.rejects(
		readRegistryArtifact(artifact, { request: async () => new Response(null, { status: 403 }) }),
		/HTTP 403/
	);
	await assert.rejects(
		readRegistryArtifact(artifact, {
			request: async () => new Response(Buffer.concat([bytes, bytes])),
		}),
		/exceeds approved size/
	);
	await assert.rejects(
		readRegistryArtifact(artifact, { request: async () => new Response(bytes.subarray(1)) }),
		/differs/
	);
	await assert.rejects(
		readRegistryArtifact(
			{ ...artifact, artifactHash: 'a'.repeat(64) },
			{ request: async () => new Response(bytes) }
		),
		/differs/
	);
});

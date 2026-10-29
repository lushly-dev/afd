/** The immutable npm blob can be visible before version metadata propagates. */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryUrl } from './shared.mjs';

export async function readRegistryArtifact(artifact, { request = fetch, timeoutMs = 10000 } = {}) {
	const { name, version, artifactHash, size } = artifact;
	if (
		!Number.isSafeInteger(size) ||
		size < 1 ||
		!/^[a-f0-9]{64}$/.test(artifactHash) ||
		!Number.isSafeInteger(timeoutMs) ||
		timeoutMs < 1 ||
		timeoutMs > 10000
	)
		throw new Error('Invalid approved artifact bounds');
	const base = name.split('/').at(-1);
	const path = `${name.split('/').map(encodeURIComponent).join('/')}/-/${encodeURIComponent(`${base}-${version}.tgz`)}`;
	const url = new URL(path, `${registryUrl}/`);
	url.searchParams.set('afd-readback', Date.now().toString());
	const response = await request(url, {
		signal: AbortSignal.timeout(timeoutMs),
		headers: { 'cache-control': 'no-cache' },
	});
	if (response.status === 404) return { notVisible: true };
	if (!response.ok) throw new Error(`Registry tarball readback HTTP ${response.status}`);
	const chunks = [];
	let length = 0;
	for await (const chunk of response.body) {
		length += chunk.length;
		if (length > size) throw new Error('Registry tarball exceeds approved size');
		chunks.push(chunk);
	}
	const bytes = Buffer.concat(chunks);
	if (length !== size || createHash('sha256').update(bytes).digest('hex') !== artifactHash)
		throw new Error(`Registry tarball differs from approved artifact: ${name}@${version}`);
	return {
		name,
		version,
		method: 'registry-tarball',
		sha256: artifactHash,
		bytes: length,
		url: url.href,
		integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
	};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [name, version, artifactHash, size, timeoutMs] = process.argv.slice(2);
	console.log(
		JSON.stringify(
			await readRegistryArtifact(
				{ name, version, artifactHash, size: Number(size) },
				{ timeoutMs: Number(timeoutMs) }
			)
		)
	);
}

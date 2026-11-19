#!/usr/bin/env node
/**
 * Writes FAST-AF's provenance records into the package being packed, as `provenance/`, with the
 * digest of `adaptations.json` stamped into `provenance.json`.
 *
 * The repository does not commit that digest: `adaptations.json` gains a row with every edit, so
 * its one hash line made any two branches that recorded different files conflict
 * (lushly-dev/afd#1610). The tarball carries it, computed from the `adaptations.json` packed beside
 * it. Each FAST-AF package runs this as its `prepack` and lists `provenance` in its `files`, so a
 * pack without the records fails the release plan (`assertPackedContents`), and
 * `assertPackedProvenance` refuses records whose digests disagree with what was packed. The
 * written directory is ignored by Git.
 *
 *   node <path to>/foundations/fast-af/scripts/pack-provenance.mjs   (from the package directory)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const records = join(dirname(fileURLToPath(import.meta.url)), '../provenance');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The family's records as packed: `{ name: Buffer }`, the envelope stamped. */
export function stampedProvenance(directory = records) {
	const envelope = JSON.parse(readFileSync(join(directory, 'provenance.json'), 'utf8'));
	const out = {};
	for (const record of Object.values(envelope.records)) {
		const bytes = readFileSync(join(directory, record.manifest));
		out[record.manifest] = bytes;
		if (record === envelope.records.adaptations) record.sha256 = sha(bytes);
	}
	out['provenance.json'] = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`);
	return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const target = join(process.cwd(), 'provenance');
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target);
	for (const [name, bytes] of Object.entries(stampedProvenance()))
		writeFileSync(join(target, name), bytes);
}

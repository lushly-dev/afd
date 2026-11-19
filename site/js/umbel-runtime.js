// Umbel, on the page.
//
// Umbel is a native program: a host an agent reaches over MCP, and a command
// line. A browser tab cannot run it. So the pages show a real run of it,
// recorded by scripts/build-site-umbel.mjs in site/umbel/runs.json: each line
// as typed, the exit code, and exactly what Umbel printed. Nothing in a result
// is written by hand.
//
// One thing does run here. Umbel's answer names the digest of the pack it read,
// and the pack's files are on this site, so the page recomputes that digest
// from the files and says whether it matches.

const UMBEL = new URL('../umbel/', import.meta.url);

/** The recorded run: when, with what, and every line. */
export async function loadRuns() {
	const response = await fetch(new URL('runs.json', UMBEL));
	if (!response.ok) throw new Error(`runs.json: ${response.status}`);
	const recorded = await response.json();
	const byId = new Map(recorded.runs.map((run) => [run.id, { ...run, result: JSON.parse(run.stdout) }]));
	return { ...recorded, run: (id) => byId.get(id) };
}

/** `2026-11-17T07:32:42.134Z` → `17 November 2026`. */
export const day = (iso) =>
	new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes) => `sha256:${hex(await crypto.subtle.digest('SHA-256', bytes))}`;

/**
 * Recompute a library's digests from the pack's files, as Specimen's pack format defines them:
 * a file's digest is the SHA-256 of its bytes, and the pack's digest is the SHA-256 of one line
 * for each record and the rules, `<path> <digest>`, sorted by path.
 * @returns {Promise<{ supported: boolean, digest?: string, catalog?: object, files?: { path: string, digest: string, matches: boolean }[] }>}
 */
export async function recomputeDigest(library) {
	if (!globalThis.crypto?.subtle) return { supported: false };
	const file = async (path) => {
		const response = await fetch(new URL(`pack/${path}`, UMBEL));
		if (!response.ok) throw new Error(`${path}: ${response.status}`);
		return response.arrayBuffer();
	};
	const catalog = JSON.parse(new TextDecoder().decode(await file(`data/${library}/library.json`)));
	const expected = [
		...catalog.components.map((component) => [`data/${library}/components/${component.tag}.json`, component.digest]),
		[`rules/${library}.json`, catalog.rules],
	].sort(([a], [b]) => (a < b ? -1 : 1));
	const files = [];
	for (const [path, stated] of expected) {
		const digest = await sha256(await file(path));
		files.push({ path, digest, matches: digest === stated });
	}
	const lines = files.map(({ path, digest }) => `${path} ${digest}\n`).join('');
	return { supported: true, digest: await sha256(new TextEncoder().encode(lines)), catalog, files };
}

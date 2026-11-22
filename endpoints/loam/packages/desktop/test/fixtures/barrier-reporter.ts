/**
 * Minimal stdio JSON-RPC fixture for the macOS WKWebView barrier test (`test/macos/barrier.test.ts`).
 *
 * The desktop app mounts this script via `mounts.json`, so every `mount_open` spawns it and advances Tauri's
 * real handle counter, and `mount_send` with method `report` writes the probe's JSON output atomically to
 * `process.argv[2]`. No external dependencies; runs directly on Node 26.
 */
import { renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const reportPath = process.argv[2];
if (!reportPath) {
	process.stderr.write('barrier-reporter: missing report output path\n');
	process.exit(1);
}

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
input.on('line', (raw) => {
	if (!raw.trim()) return;
	let message: { id?: unknown; method?: unknown; params?: unknown };
	try {
		message = JSON.parse(raw) as { id?: unknown; method?: unknown; params?: unknown };
	} catch {
		return;
	}
	if (message.method === 'report') {
		const tmp = `${reportPath}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(message.params ?? null, null, '\t')}\n`, 'utf8');
		renameSync(tmp, reportPath);
	}
	if (message.id !== undefined) {
		process.stdout.write(
			`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })}\n`
		);
	}
});

/**
 * @fileoverview The runtime frame's bootstrap (phase 5 specification, 3.2): a small first-party script in an
 * opaque-origin frame (`sandbox="allow-scripts"`, no `allow-same-origin`). It takes each session's three ports from
 * its parent, starts one dedicated worker per runtime chunk from a `blob:` URL whose only line is `importScripts` of
 * that chunk on the copilot path, and hands the ports on. It holds no data the runtime reads, loads no third-party
 * module, opens no connection and no peer connection, and acts on no message but its parent's.
 */

/** The runtime chunk of each provider kind (16): `test` answers in Anthropic's format. */
const CHUNK_OF: Readonly<Record<string, string>> = Object.freeze({
	anthropic: 'runtime-anthropic.js',
	test: 'runtime-anthropic.js',
	openai: 'runtime-openai.js',
	'openai-compatible': 'runtime-openai.js',
});

/** This script's directory, the copilot path, which the frame's policy names (3.2). */
const base = new URL(
	'.',
	(document.currentScript as HTMLScriptElement | null)?.src ?? location.href
).href;
const workers = new Map<string, Worker>();

function workerFor(chunk: string): Worker {
	const found = workers.get(chunk);
	if (found) return found;
	const url = URL.createObjectURL(
		new Blob([`importScripts(${JSON.stringify(new URL(chunk, base).href)});`], {
			type: 'text/javascript',
		})
	);
	const worker = new Worker(url);
	workers.set(chunk, worker);
	return worker;
}

window.addEventListener('message', (event) => {
	// Only the parent, which created this frame: never a message from a worker, a view or another window.
	if (event.source !== window.parent) return;
	const data = event.data as { kind?: unknown } | null;
	const kind = typeof data?.kind === 'string' ? data.kind : '';
	const chunk = Object.hasOwn(CHUNK_OF, kind) ? CHUNK_OF[kind] : undefined;
	if (!chunk || event.ports.length !== 3) return;
	workerFor(chunk).postMessage(null, [...event.ports]);
});

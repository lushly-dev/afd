/**
 * @fileoverview The runtime frame's bootstrap (phase 5 specification, 3.2): a small first-party script in an
 * opaque-origin frame (`sandbox="allow-scripts"`, no `allow-same-origin`). It takes each session's three ports from
 * its parent, starts one dedicated worker per session from a `blob:` URL whose only line is `importScripts` of its
 * provider kind's chunk on the copilot path, and hands the ports on. A worker per session, not per chunk (phase 5's
 * step 4, #1508): a compromised runtime then holds one session's ports alone, so taint never crossing sessions (3.4)
 * rests on the frame, not on the runtime's honesty. It holds no data the runtime reads, loads no third-party
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
/**
 * One `blob:` URL per chunk, made once. Workers are not evicted: the host keeps a session's ports for the frame's life,
 * so a worker ended under it would strand its session (the review's B13); the frame and every worker go together.
 */
const urls = new Map<string, string>();

/** A new worker for one session's ports: no session shares a worker, and so none shares a runtime's memory. */
function workerFor(chunk: string): Worker {
	let url = urls.get(chunk);
	if (url === undefined) {
		url = URL.createObjectURL(
			new Blob([`importScripts(${JSON.stringify(new URL(chunk, base).href)});`], {
				type: 'text/javascript',
			})
		);
		urls.set(chunk, url);
	}
	return new Worker(url);
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

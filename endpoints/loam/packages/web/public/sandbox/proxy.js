/**
 * The sandbox proxy (phase 1 specification, 6.1; D62), served on `sandbox.origin`: it is the only window
 * the shell and a view each speak to. It puts the view's HTML in an opaque-origin iframe under MCP Apps'
 * default CSP, and forwards messages between the two, checking who sent each. It creates no request of
 * its own, and a view's messages about the sandbox itself go nowhere.
 */
(() => {
	const SANDBOX_MESSAGE = 'ui/notifications/sandbox-';
	const INNER_SANDBOX = 'allow-scripts allow-forms';
	// First in the document, before anything of the view's. The one place this policy is written.
	const INNER_CSP =
		"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'\">";

	const query = new URLSearchParams(location.search);
	const host = query.get('host');
	const title = query.get('title') ?? '';
	if (title) document.title = title;
	if (!host || window.parent === window) return;

	let inner = null;
	const aboutTheSandbox = (data) =>
		typeof data?.method === 'string' && data.method.startsWith(SANDBOX_MESSAGE);

	function render(html) {
		if (inner || typeof html !== 'string') return;
		inner = document.createElement('iframe');
		inner.setAttribute('sandbox', INNER_SANDBOX);
		inner.title = title;
		inner.srcdoc = INNER_CSP + html;
		document.body.append(inner);
	}

	window.addEventListener('message', (event) => {
		if (event.source === window.parent && event.origin === host) {
			if (event.data?.method === `${SANDBOX_MESSAGE}resource-ready`)
				render(event.data.params?.html);
			else if (!aboutTheSandbox(event.data)) inner?.contentWindow?.postMessage(event.data, '*');
		} else if (inner && event.source === inner.contentWindow && !aboutTheSandbox(event.data)) {
			window.parent.postMessage(event.data, host);
		}
	});
	window.parent.postMessage(
		{ jsonrpc: '2.0', method: `${SANDBOX_MESSAGE}proxy-ready`, params: {} },
		host
	);
})();

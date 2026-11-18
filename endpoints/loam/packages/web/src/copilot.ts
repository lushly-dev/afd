/**
 * @fileoverview The web host's copilot (phase 5 specification, 3.1 and 3.2), in a chunk of its own that loads when
 * the first turn starts: the runtime's opaque-origin frame on the sandbox origin, the model transport, and the
 * kernel's port halves over them. The main frame never acts on a `window` message from the frame: it adds no
 * listener for one, and reaches the frame only through the three ports it transfers per session.
 */

import { createTestProvider, type ModelScriptV1 } from '@lushly-dev/loam-copilot/test-provider';
import {
	type CopilotHostV1,
	type CopilotProviderV1,
	createCopilotHost,
	type ModelTransportV1,
	type RuntimeLauncherV1,
} from '@lushly-dev/loam-kernel/copilot';

/** The frame's document on the sandbox origin (3.2): its `copilot/` path, which its own policy names. */
export const COPILOT_FRAME_PATH = '/sandbox/copilot/index.html';

export interface FrameLauncher extends RuntimeLauncherV1 {
	/** The frame, while it exists. */
	readonly frame: HTMLIFrameElement | undefined;
}

/**
 * One hidden frame per shell window (3.2), `sandbox="allow-scripts"` with no `allow-same-origin`, so it and its
 * workers have an opaque origin and share no storage with the shell. Each session's ports are transferred to it
 * once it has loaded; `reset` removes it, ending every runtime in it.
 */
export function createFrameLauncher(document: Document, sandboxOrigin: string): FrameLauncher {
	let frame: HTMLIFrameElement | undefined;
	let loaded: Promise<HTMLIFrameElement> | undefined;
	function open(): Promise<HTMLIFrameElement> {
		if (loaded && frame) return loaded;
		const made = document.createElement('iframe');
		made.setAttribute('sandbox', 'allow-scripts');
		made.setAttribute('aria-hidden', 'true');
		made.setAttribute('tabindex', '-1');
		made.title = 'Copilot runtime';
		made.dataset.loamCopilot = 'runtime';
		made.style.display = 'none';
		made.src = new URL(COPILOT_FRAME_PATH, sandboxOrigin).href;
		frame = made;
		loaded = new Promise((resolve) => {
			made.addEventListener('load', () => resolve(made), { once: true });
		});
		document.body.append(made);
		return loaded;
	}
	return {
		get frame() {
			return frame;
		},
		launch(kind, ports) {
			void open().then((opened) => {
				// The frame may have been removed while it loaded: its ports then go nowhere.
				if (opened !== frame) return;
				// An opaque origin matches no target origin but `*`; the window is the one this page created.
				opened.contentWindow?.postMessage({ kind }, '*', [
					ports.agent as unknown as MessagePort,
					ports.model as unknown as MessagePort,
					ports.panel as unknown as MessagePort,
				]);
			});
		},
		reset() {
			frame?.remove();
			frame = undefined;
			loaded = undefined;
		},
	};
}

/**
 * The model transport of a page (4.2): the test provider for `kind = "test"`, the only kind a static deployment may
 * name. A real provider is the trusted host's: the desktop's `model_send` (step 2) or the hosted server's route
 * (milestone C), so any other kind is refused here.
 */
export function createPageTransport(
	scripts: Readonly<Record<string, ModelScriptV1>> = {}
): ModelTransportV1 {
	const test = createTestProvider({ scripts });
	return {
		async send(provider, body, signal) {
			if (provider.kind !== 'test') {
				throw Object.assign(new Error(`No model transport for '${provider.kind}' in this host`), {
					code: 'COPILOT_PROVIDER_UNKNOWN',
				});
			}
			return test.send(body, signal);
		},
	};
}

export interface WebCopilot {
	host: CopilotHostV1;
	launcher: FrameLauncher;
}

/** The copilot of a page: the frame on `sandboxOrigin`, the page's transport, and the kernel's halves over them. */
export function createWebCopilot(options: {
	document: Document;
	sandboxOrigin: string;
	transport?: ModelTransportV1;
	onRefused?: (port: 'model' | 'panel', reason: string) => void;
}): WebCopilot {
	const launcher = createFrameLauncher(options.document, options.sandboxOrigin);
	const host = createCopilotHost({
		launcher,
		transport: options.transport ?? createPageTransport(),
		...(options.onRefused ? { onRefused: options.onRefused } : {}),
	});
	return { host, launcher };
}

export type { CopilotProviderV1 };

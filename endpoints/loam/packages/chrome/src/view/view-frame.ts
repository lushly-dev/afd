/**
 * @fileoverview `loam-view-frame`: main's sandboxed view (phase 1 specification, 6.1 and 6.2): the outer
 * iframe on the sandbox's origin, with its loading and failed states. It takes `{ html }` from a
 * `ViewSource`, so a later source adds no contract (section 13). It does not animate.
 */

import { attr, css, FASTElement, html, observable, when } from '@lushly-dev/fast-element';
import type { AppPortV1 } from '@lushly-dev/loam-kernel';
import { ProxyChannel } from './channel.js';
import { readTokens } from './tokens.js';
import { ViewHost, type ViewHostContext } from './view-host.js';

/** No `initialized` by then, and the frame is removed (section 10). */
export const VIEW_READY_TIMEOUT_MS = 15_000;
/** How long a view has to answer `ui/resource-teardown` (6.2). */
export const VIEW_TEARDOWN_MS = 500;

/** Where a view's HTML comes from. */
export interface ViewSource {
	read(uri: string): Promise<{ html: string }>;
}

/** Phase 1's source: a file of the app's package. */
export const packageViewSource = (port: AppPortV1): ViewSource => ({
	read: async (uri) => ({ html: await port.readResource(uri) }),
});

export interface ViewFrameOptions {
	port: AppPortV1;
	source: ViewSource;
	/** The app's title: the frame's name. */
	heading: string;
	hostVersion: string;
	resource: string;
	command?: string;
	selection?: string | null;
	theme(): ViewHostContext['theme'];
	/** The view has sent `initialized`, or failed. */
	onSettled?(failed: boolean): void;
}

export interface ViewFrameFailure {
	code: string;
	message: string;
	suggestion: string;
}

const template = html<LoamViewFrame>`
	<p class="loading" role="status" ?hidden="${(x) => x.state !== 'loading'}">
		Opening ${(x) => x.heading}…
	</p>
	${when(
		(x) => x.state === 'failed',
		html<LoamViewFrame>`<loam-notice
			embedded
			:heading="${(x) => x.heading}"
			:message="${(x) => `${x.failure?.message ?? 'This view is unavailable.'} (${x.failure?.code ?? ''})`}"
			:suggestion="${(x) => x.failure?.suggestion ?? ''}"
		></loam-notice>`
	)}
	<div
		class="frame"
		?data-waiting="${(x) => x.state !== 'ready'}"
	></div>
`;

const styles = css`
	:host {
		display: block;
		position: relative;
		box-sizing: border-box;
		block-size: 100%;
		min-block-size: 0;
		background: var(--color-surface-page);
		color: var(--color-text-primary);
		font-size: var(--type-body-md-size);
		line-height: var(--type-body-md-line);
	}
	:host([hidden]),
	[hidden] {
		display: none;
	}
	.loading {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		margin: var(--space-layout-md);
		color: var(--color-text-secondary);
	}
	.frame {
		block-size: 100%;
	}
	.frame[data-waiting] {
		visibility: hidden;
	}
	iframe {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		border: 0;
	}
	@media (forced-colors: active) {
		:host,
		.loading {
			background: Canvas;
			color: CanvasText;
		}
	}
`;

export class LoamViewFrame extends FASTElement {
	declare heading: string;
	declare state: 'loading' | 'ready' | 'failed';
	declare failure: ViewFrameFailure | null;
	#options: ViewFrameOptions | null = null;
	#channel: ProxyChannel | null = null;
	#host: ViewHost | null = null;
	#selection: string | null | undefined;
	#dimensions = { width: 0, height: 0 };
	#readyTimer: ReturnType<typeof setTimeout> | undefined;
	#resize: ResizeObserver | null = null;
	#appearance: MutationObserver | null = null;
	#started = false;
	#leaving = false;

	constructor() {
		super();
		this.heading = '';
		this.state = 'loading';
		this.failure = null;
	}

	/** Give the frame its app before it connects. */
	configure(options: ViewFrameOptions): void {
		this.#options = options;
		this.heading = options.heading;
		this.#selection = options.selection;
	}

	set selection(id: string | null) {
		if (id === this.#selection) return;
		this.#selection = id;
		this.#host?.changeContext({ 'dev.loam/selection': id });
	}

	override connectedCallback(): void {
		super.connectedCallback();
		if (this.#options && !this.#started) {
			this.#started = true;
			void this.#start(this.#options);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		clearTimeout(this.#readyTimer);
		this.#close();
	}

	async #start(options: ViewFrameOptions): Promise<void> {
		const sandboxOrigin = options.port.view?.sandboxOrigin;
		const broker = options.port.view;
		if (!broker || !sandboxOrigin) {
			this.#fail({
				code: 'VIEW_SANDBOX_ORIGIN_INVALID',
				message: 'A view app needs a sandbox on a second origin.',
				suggestion: 'Deploy `dist/sandbox/` on a second origin and set `[sandbox] origin`.',
			});
			return;
		}
		let source: { html: string };
		try {
			source = await options.source.read(options.resource);
		} catch (cause) {
			const { code, message, suggestion } = cause as Partial<ViewFrameFailure>;
			this.#fail({
				code: code ?? 'VIEW_RESOURCE_UNAVAILABLE',
				message: message ?? 'The view could not be read from the package.',
				suggestion: suggestion ?? 'Run `loam app pack`, and deploy again.',
			});
			return;
		}
		if (!this.isConnected || this.#leaving) return;
		const { ownerDocument: document } = this;
		const channel = new ProxyChannel({
			document,
			sandboxOrigin,
			title: options.heading,
			html: source.html,
		});
		this.#channel = channel;
		this.#readDimensions();
		this.#host = new ViewHost({
			channel,
			broker,
			instance: options.port.instance,
			hostVersion: options.hostVersion,
			resource: options.resource,
			...(options.command !== undefined ? { command: options.command } : {}),
			context: () => this.#context(),
			onInitialized: () => {
				clearTimeout(this.#readyTimer);
				this.state = 'ready';
				options.onSettled?.(false);
			},
		});
		this.#watch(document);
		this.#readyTimer = setTimeout(() => {
			this.#fail({
				code: 'VIEW_READY_TIMEOUT',
				message: `${options.heading} did not start in time.`,
				suggestion: 'Reopen it, and check that the view calls `ui/initialize`.',
			});
		}, VIEW_READY_TIMEOUT_MS);
		this.shadowRoot?.querySelector('.frame')?.append(channel.frame);
	}

	#context(): ViewHostContext {
		return {
			theme: this.#options?.theme() ?? 'light',
			platform: 'web',
			displayMode: 'inline',
			containerDimensions: { ...this.#dimensions },
			'dev.loam/tokens': readTokens(this.ownerDocument),
			...(this.#selection !== undefined ? { 'dev.loam/selection': this.#selection } : {}),
		};
	}

	#readDimensions(): boolean {
		const { width, height } = this.getBoundingClientRect();
		const next = { width: Math.round(width), height: Math.round(height) };
		if (next.width === this.#dimensions.width && next.height === this.#dimensions.height) {
			return false;
		}
		this.#dimensions = next;
		return true;
	}

	/** A resize, and a change of theme or density, reach the view through `host-context-changed`. */
	#watch(document: Document): void {
		const view = document.defaultView ?? window;
		this.#resize = new view.ResizeObserver(() => {
			if (!this.#readDimensions()) return;
			this.#host?.changeContext({ containerDimensions: { ...this.#dimensions } });
		});
		this.#resize.observe(this);
		this.#appearance = new view.MutationObserver(() => {
			this.#host?.changeContext({
				theme: this.#options?.theme() ?? 'light',
				'dev.loam/tokens': readTokens(document),
			});
		});
		this.#appearance.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-loam-theme', 'data-loam-density'],
		});
	}

	#fail(failure: ViewFrameFailure): void {
		clearTimeout(this.#readyTimer);
		this.#close();
		this.failure = failure;
		this.state = 'failed';
		this.#options?.onSettled?.(true);
	}

	#close(): void {
		this.#resize?.disconnect();
		this.#appearance?.disconnect();
		this.#resize = null;
		this.#appearance = null;
		this.#host?.dispose();
		this.#host = null;
		this.#channel?.close();
		this.#channel = null;
	}

	/**
	 * Leave main. A view that has sent `initialized` is hidden, told, and removed after its answer or
	 * 500 ms: moving or removing its iframe would end it first. Before that, it is simply removed (6.2).
	 */
	leave(): void {
		if (this.#leaving) return;
		this.#leaving = true;
		clearTimeout(this.#readyTimer);
		const host = this.#host;
		if (!host?.initialized) {
			this.remove();
			return;
		}
		this.hidden = true;
		void host.teardown(VIEW_TEARDOWN_MS).finally(() => this.remove());
	}
}
attr(LoamViewFrame.prototype, 'heading');
attr(LoamViewFrame.prototype, 'state');
observable(LoamViewFrame.prototype, 'failure');

export const viewFrameDefinition = { name: 'loam-view-frame', template, styles } as const;

/**
 * Regression tests for #2444: `AppSurfaces.start()` waits for `shell.ready` (and the pending FAST
 * update flush) so `loam-main` exists before `$fastController.addStyles` runs, returns cleanly if
 * the shell disconnects while starting, and throws a clear diagnostic when `loam-main` is absent on
 * a connected shell.
 */
import type { LoamKernel } from '@lushly-dev/loam-kernel';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lushly-dev/fast-element', () => ({
	css: () => ({}),
	html: () => ({}),
	attr: () => () => {},
	observable: () => {},
	when: () => ({}),
	repeat: () => ({}),
	ref: () => () => {},
	FASTElement: class {},
	Updates: { next: () => Promise.resolve() },
}));
vi.mock('../elements/app-entry.js', () => ({ APP_OPEN_EVENT: 'loam-app-open' }));
vi.mock('../elements/list.js', () => ({ LIST_SELECT_EVENT: 'loam-list-select' }));
vi.mock('../elements/part-header.js', () => ({ PART_ACTION_EVENT: 'loam-part-action' }));
vi.mock('../elements/status-action.js', () => ({ STATUS_ACTION_EVENT: 'loam-status-action' }));
vi.mock('./define-elements.js', () => ({ defineAppElements: async () => {} }));
vi.mock('./kit-loader.js', () => ({ createKit: () => ({ define: async () => {} }) }));

const reported: unknown[] = [];
vi.stubGlobal('reportError', (cause: unknown) => reported.push(cause));
vi.stubGlobal('customElements', { get: () => undefined });
vi.stubGlobal('HTMLElement', class {});

import type { LoamShell } from '../elements/shell.js';
import { AppSurfaces } from './surfaces.js';

function createKernelStub(): LoamKernel {
	return {
		subscribe: () => () => {},
		call: vi.fn(async () => ({ success: true, data: { active: null, apps: [], overlays: [] } })),
		startInstances: vi.fn(async () => {}),
		lateFailure: undefined,
	} as unknown as LoamKernel;
}

function createFakeMain() {
	return {
		dataset: {} as Record<string, string>,
		setAttribute: vi.fn(),
		removeAttribute: vi.fn(),
		querySelector: vi.fn(() => null),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		focus: vi.fn(),
		$fastController: {
			addStyles: vi.fn(),
		},
	};
}

function createFakeShell(options: {
	ready: Promise<void>;
	main: () => ReturnType<typeof createFakeMain> | null;
	isConnected?: () => boolean;
}): LoamShell {
	const elementStub = {
		hidden: false,
		isOpen: false,
		children: [],
		childElementCount: 0,
		dataset: {} as Record<string, string>,
		setAttribute: vi.fn(),
		removeAttribute: vi.fn(),
		querySelector: vi.fn(() => null),
		querySelectorAll: vi.fn(() => []),
		append: vi.fn(),
		remove: vi.fn(),
		hide: vi.fn(() => false),
		close: vi.fn(),
		clear: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
	const view = {
		requestAnimationFrame: (callback: () => void) => {
			queueMicrotask(callback);
			return 1;
		},
	};
	return {
		ready: options.ready,
		landing: '',
		presentation: {
			sidebar: 'inline',
			inspector: 'closed',
			panel: 'closed',
			layoutClass: 'expanded',
		},
		rail: {
			fresh: vi.fn(async () => ({ active: null, apps: [] })),
		},
		shadowRoot: {
			querySelector: (selector: string) => {
				if (selector === 'loam-main') return options.main();
				return elementStub;
			},
			append: vi.fn(),
		},
		ownerDocument: {
			defaultView: view,
			createElement: () => ({ ...elementStub }),
		},
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		$fastController: {
			get isConnected() {
				return options.isConnected ? options.isConnected() : true;
			},
		},
	} as unknown as LoamShell;
}

describe('AppSurfaces.start() (#2444)', () => {
	it('waits for shell.ready before reading loam-main.$fastController', async () => {
		let main: ReturnType<typeof createFakeMain> | null = null;
		let finishReady!: () => void;
		const ready = new Promise<void>((resolve) => {
			finishReady = resolve;
		});
		const shell = createFakeShell({ ready, main: () => main });
		const surfaces = new AppSurfaces(shell, createKernelStub());

		const starting = surfaces.start();
		// Before shell.ready resolves, loam-main is still absent; start() must wait rather than throwing.
		await Promise.resolve();
		main = createFakeMain();
		finishReady();

		await expect(starting).resolves.toBeUndefined();
		expect(main.$fastController.addStyles).toHaveBeenCalledTimes(1);
		expect(reported).toEqual([]);
		surfaces.dispose();
	});

	it('returns cleanly without throwing when the shell disconnects before parts render', async () => {
		let connected = true;
		let finishReady!: () => void;
		const ready = new Promise<void>((resolve) => {
			finishReady = resolve;
		});
		const shell = createFakeShell({
			ready,
			main: () => null,
			isConnected: () => connected,
		});
		const surfaces = new AppSurfaces(shell, createKernelStub());

		const starting = surfaces.start();
		connected = false;
		finishReady();

		await expect(starting).resolves.toBeUndefined();
		surfaces.dispose();
	});

	it('returns cleanly without attaching overlays or styles when disposed while loam-main stays in shadowRoot', async () => {
		let connected = true;
		let finishReady!: () => void;
		const ready = new Promise<void>((resolve) => {
			finishReady = resolve;
		});
		const main = createFakeMain();
		const shell = createFakeShell({
			ready,
			main: () => main,
			isConnected: () => connected,
		});
		const kernel = createKernelStub();
		const surfaces = new AppSurfaces(shell, kernel);
		const listenerCountAtConstruct = vi.mocked(shell.addEventListener).mock.calls.length;

		const starting = surfaces.start();
		connected = false;
		surfaces.dispose();
		finishReady();

		await expect(starting).resolves.toBeUndefined();
		expect(main.$fastController.addStyles).not.toHaveBeenCalled();
		expect(shell.shadowRoot?.append).not.toHaveBeenCalled();
		expect(vi.mocked(shell.addEventListener).mock.calls.length).toBe(listenerCountAtConstruct);
		expect(kernel.startInstances).not.toHaveBeenCalled();
	});

	it('throws a clear diagnostic instead of a null $fastController read when loam-main is absent', async () => {
		const shell = createFakeShell({ ready: Promise.resolve(), main: () => null });
		const surfaces = new AppSurfaces(shell, createKernelStub());

		await expect(surfaces.start()).rejects.toThrow(
			'AppSurfaces.start() requires loam-main in loam-shell shadowRoot'
		);
		surfaces.dispose();
	});
});

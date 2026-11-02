/**
 * What the chrome's Specimen fixtures share: Loam's theme on the specimen document, a memory
 * test kernel, and a mounted shell that Specimen captures once it has read the kernel's state.
 * Specimen chooses the theme through media (D53), so fixtures resolve `system` from `matchMedia`.
 */

import { APPEARANCE_QUERIES, type LoamKernelV0 } from '@lushly-dev/loam-kernel';
import {
	createFixedEnvironment,
	createTestKernel,
	type SessionCall,
} from '@lushly-dev/loam-kernel/testing';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import {
	applyAppearance,
	applyThemeStylesheet,
	defineChrome,
	definePalette,
	type LoamShell,
	mountShell,
} from '../dist/index.js';

export type Density = 'comfortable' | 'compact';

/** `window.matchMedia` as a kernel environment. */
export const mediaEnvironment = {
	matches: (query: string) => matchMedia(query).matches,
	onChange(query: string, listener: () => void) {
		const list = matchMedia(query);
		list.addEventListener('change', listener);
		return () => list.removeEventListener('change', listener);
	},
};

/** The theme the media choose, as `appearance: system` resolves it (6.3). */
export function mediaTheme(): 'light' | 'dark' | 'high-contrast' {
	if (matchMedia(APPEARANCE_QUERIES.forcedColors).matches) return 'high-contrast';
	if (matchMedia(APPEARANCE_QUERIES.moreContrast).matches) return 'high-contrast';
	return matchMedia(APPEARANCE_QUERIES.dark).matches ? 'dark' : 'light';
}

/** Theme a document for a part rendered on its own, without a kernel. */
export async function themePart(density: Density = 'comfortable'): Promise<void> {
	applyThemeStylesheet(document, themeCss);
	applyAppearance(document, { theme: 'system', density, resolved: mediaTheme() }, false);
	await defineChrome();
	await definePalette();
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export interface ShellFixture {
	element: HTMLElement;
	ready: Promise<void>;
	dispose: () => Promise<void>;
}

/** Mount the shell over `kernel` into a container, after running `calls` on it. */
export function shellFixture(
	create: () => Promise<{ kernel: LoamKernelV0; calls?: readonly SessionCall[] }>,
	afterMount?: (shell: LoamShell) => Promise<void>
): ShellFixture {
	const element = document.createElement('div');
	element.dataset.fixture = 'shell';
	let kernel: LoamKernelV0 | undefined;
	const ready = (async () => {
		const created = await create();
		kernel = created.kernel;
		for (const call of created.calls ?? []) {
			const target = call.interface === 'agent' ? kernel.agent : kernel;
			await target.call(call.name, call.input ?? {});
		}
		// Specimen serves each render under a path of its own; a fixed home keeps renders comparable.
		const shell: LoamShell = await mountShell(element, { kernel, themeCss, home: '/' });
		await shell.preparePalette();
		await afterMount?.(shell);
		await frame();
		await frame();
	})();
	return {
		element,
		ready,
		dispose: async () => {
			element.replaceChildren();
			await kernel?.dispose();
		},
	};
}

/**
 * Wait, a frame at a time, until `check` holds; fail after about two seconds. A check that throws
 * is not ready yet (a lazily loaded part may not exist on the first frames), so it is retried.
 */
export async function until(check: () => boolean): Promise<void> {
	let last: unknown;
	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			if (check()) return;
		} catch (error) {
			last = error;
		}
		await frame();
	}
	throw new Error('The fixture never reached its state', { cause: last });
}

/** A test kernel whose `system` theme follows the specimen's media. */
export const mediaKernel = () => createTestKernel({ environment: mediaEnvironment });

/** A test kernel with a fixed environment, as replay builds one (E2). */
export const fixedKernel = () => createTestKernel({ environment: createFixedEnvironment() });

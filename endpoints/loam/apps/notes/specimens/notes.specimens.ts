/**
 * `notes`' Specimen fixtures (documents specification, D10; Screens from Jobs Phase 5):
 * - Isolated component specimens for `notes-editor`, `notes-inspector`, and `notes-embed`,
 *   comfortable and compact.
 * - Real-shell job specimens (`NotesConflict`, `NotesConflictCompact`) driving `scenarios/notes-conflict.scenario.yaml`
 *   through the real `loam-shell` + `notes` kernel with a mount-level `call(name, input)` interface,
 *   replacing the hand-built conflict stubs.
 * Specimen renders each in the light, dark and high-contrast contexts. Here, not in the chrome's
 * fixtures, since no file of the chrome names a type (D2).
 */

import type { LoamShell } from '@lushly-dev/loam-chrome';
import type { AppContextV1, DocumentRefV1 } from '@lushly-dev/loam-sdk';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import '@lushly-dev/violet-elements/button/define';
import '@lushly-dev/violet-elements/text-area/define';
// The link picker's field, which Specimen waits to see defined before it observes the editor.
import '@lushly-dev/violet-elements/text-field/define';
import { defineNotesElements, type NotesEditor } from '../src/notes-editor.js';
import type { NotesEmbed } from '../src/notes-embed.js';
import type { NotesInspector } from '../src/notes-inspector.js';
import { NOTES_MANIFEST } from './notes-manifest.js';

type Density = 'comfortable' | 'compact';
type CallerInterface = 'person' | 'agent';

/** The theme the media choose, as the shell resolves `system` (phase 0 specification, 6.3). */
function mediaTheme(): 'light' | 'dark' | 'high-contrast' {
	if (matchMedia('(forced-colors: active)').matches) return 'high-contrast';
	if (matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let themed = false;
function theme(density: Density): void {
	if (!themed) {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(themeCss);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		themed = true;
	}
	const root = document.documentElement;
	root.dataset.loamTheme = mediaTheme();
	if (density === 'compact') root.dataset.loamDensity = 'compact';
	else delete root.dataset.loamDensity;
}

const REFERENCE: DocumentRefV1 = {
	id: 'doc_fixture00001',
	type: 'notes',
	title: 'Roadmap',
	scope: { workspace: 'personal' },
	contentVersion: 1,
	binding: {
		model: 'command',
		selection: 'text-range',
		locator: 'text-range',
		conflict: 'last-writer-wins',
	},
	readOnly: false,
};

/** A context whose client answers `notes-content-get` with what the store holds now. */
function contextOver(held: { text: string }): AppContextV1 {
	return {
		instance: 'notes',
		app: 'notes',
		version: '0.1.0',
		config: {},
		registry: customElements,
		kit: { define: async () => {} },
		overlays: {} as AppContextV1['overlays'],
		client: {
			call: async (name: string) =>
				name === 'notes-content-get'
					? ({ success: true, data: { text: held.text, embeds: [] } } as never)
					: ({ success: true, data: {} } as never),
		},
	};
}

function fixture(density: Density): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = 'notes-editor';
			wrapper.style.setProperty('inline-size', '640px');
			wrapper.style.setProperty('block-size', '360px');
			return {
				element: wrapper,
				ready: (async () => {
					theme(density);
					const held = { text: 'Ship the editor area.' };
					const context = contextOver(held);
					if (!customElements.get('notes-editor')) await defineNotesElements(context);
					const editor = document.createElement('notes-editor') as NotesEditor;
					editor.context = context;
					editor.document = REFERENCE;
					wrapper.append(editor);
					await new Promise((resolve) => setTimeout(resolve, 50));
					editor.area.value = 'Ship the editor area, then the documents section.';
					editor.area.dispatchEvent(
						new CustomEvent('input', { detail: { value: editor.area.value } })
					);
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				})(),
			};
		},
	};
}

export const [Editor, EditorCompact] = [fixture('comfortable'), fixture('compact')];

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type HostedShell = LoamShell & {
	apps?: { idle?: Promise<void>; start?: () => Promise<void> } | null;
	editor?: { idle?: Promise<void> };
	call?: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
};

/** Wait until the shell's app surfaces, editor queue, mounted frames, and `notes-editor` reads settle. */
async function settleShell(
	shell: HostedShell,
	command?: string,
	input?: Record<string, unknown>
): Promise<void> {
	const minFrames = command === 'document-open' ? (input?.group === 'beside' ? 2 : 1) : 0;
	for (let round = 0; round < 40; round++) {
		await shell.apps?.idle;
		const queued = shell.editor?.idle;
		await queued;
		await macrotask();
		await frame();
		await frame();
		const main = shell.shadowRoot?.querySelector('loam-main');
		const area = main?.querySelector('loam-editor-area:not([hidden])');
		const frames = [...(area?.querySelectorAll('loam-editor-frame:not([hidden])') ?? [])];
		const loading = frames.some(
			(each) => (each as unknown as { state?: string }).state === 'loading'
		);
		const editorReady =
			minFrames === 0 || (shell.editor !== undefined && frames.length >= minFrames);
		if (editorReady && !loading && shell.editor?.idle === queued) {
			// One extra macrotask + animation frame so `notes-editor`'s async `#read()` and FAST Updates flush.
			await macrotask();
			await frame();
			return;
		}
	}
	throw new Error(
		`notesShellJob: shell did not settle within 40 rounds${command ? ` after ${command}` : ''}`
	);
}

/**
 * Mount the real `loam-shell` with the real `notes` app and expose the kernel's `call` on the
 * mounted shell (mount-level caller interface: `person` -> `kernel.call`, `agent` -> `kernel.agent.call`).
 */
function notesShellJob(density: Density, caller: CallerInterface = 'person'): SpecimenDefinition {
	return {
		targets: {
			shell: { selector: 'loam-shell' },
			'second-editor': { selector: 'loam-editor-frame[data-tab="t2"] textarea' },
		},
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = 'notes-conflict';
			let disposeKernel: (() => Promise<void>) | undefined;
			const ready = (async () => {
				// Load `loam-chrome` (and define its shell elements) before `loam-testing` starts
				// watching `customElements.define`; otherwise `loam-chrome`'s top-level shell
				// imports (`violet-icon`, `violet-text`, `violet-empty-state`) trip
				// `createAppTestKernel`'s `APP_GLOBAL_ELEMENT` check for the app.
				const { defineChrome, mountShell } = await import('@lushly-dev/loam-chrome');
				await defineChrome();
				const { createAppTestKernel } = await import('@lushly-dev/loam-testing');
				const { kernel } = await createAppTestKernel({
					manifest: NOTES_MANIFEST,
					definition: () => import('../src/native.js'),
				});
				disposeKernel = () => kernel.dispose();
				await kernel.call('appearance-set', { theme: mediaTheme(), density });
				const shell = (await mountShell(wrapper, {
					kernel,
					themeCss,
					home: '/',
					listsApps: true,
				})) as HostedShell;
				await kernel.appsReady;
				for (let wait = 0; wait < 40 && (!shell.apps || !shell.urlBooted); wait++) {
					await macrotask();
					await frame();
				}
				if (!shell.apps || !shell.urlBooted) {
					throw new Error(
						`notesShellJob: shell did not finish stage B within 40 frames (apps=${Boolean(shell.apps)}, urlBooted=${Boolean(shell.urlBooted)})`
					);
				}
				await shell.apps.start?.();
				await settleShell(shell);
				const target = caller === 'agent' ? kernel.agent : kernel;
				shell.call = async (name: string, input?: Record<string, unknown>) => {
					const result = await target.call(name, input ?? {});
					const ok = (result as { success?: boolean } | null)?.success === true;
					await settleShell(shell, ok ? name : undefined, ok ? input : undefined);
					return result;
				};
			})();
			return {
				element: wrapper,
				ready,
				dispose: async () => {
					wrapper.replaceChildren();
					await disposeKernel?.();
				},
			};
		},
	};
}

export const [NotesConflict, NotesConflictCompact] = [
	notesShellJob('comfortable'),
	notesShellJob('compact'),
];

const row = (id: string, title: string, status: 'active' | 'trashed') => ({
	link: {
		id: `lnk_${id}`,
		workspace: 'personal',
		from: REFERENCE.id,
		to: id,
		anchor: null,
		kind: 'reference',
		createdAt: 1,
		createdBy: 'local',
	},
	document: { id, title, type: 'notes', status, scope: { workspace: 'personal' } },
});

/** `notes-inspector` with a link and a backlink in the trash, and `notes-embed` with its text (10). */
function part(density: Density, which: 'notes-inspector' | 'notes-embed'): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = which;
			wrapper.style.setProperty('inline-size', which === 'notes-inspector' ? '280px' : '480px');
			return {
				element: wrapper,
				ready: (async () => {
					theme(density);
					const context: AppContextV1 = {
						...contextOver({ text: 'Plans for the quarter, and what ships first.' }),
						documents: {
							get: async () => null,
							list: async () => [],
							links: async () => ({
								out: [row('doc_fixture00002', 'Launch plan', 'active')] as never,
								in: [row('doc_fixture00003', 'Old notes', 'trashed')] as never,
							}),
							open: async () => {},
						},
					};
					if (!customElements.get('notes-editor')) await defineNotesElements(context);
					const element = document.createElement(which) as NotesInspector | NotesEmbed;
					element.context = context;
					element.document = { ...REFERENCE, readOnly: which === 'notes-embed' };
					wrapper.append(element);
					await new Promise((resolve) => setTimeout(resolve, 50));
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				})(),
			};
		},
	};
}

export const [Inspector, InspectorCompact] = [
	part('comfortable', 'notes-inspector'),
	part('compact', 'notes-inspector'),
];
export const [Embed, EmbedCompact] = [
	part('comfortable', 'notes-embed'),
	part('compact', 'notes-embed'),
];

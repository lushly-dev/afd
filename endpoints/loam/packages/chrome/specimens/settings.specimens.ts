/**
 * Phase 4's captures (phase 4 specification, 15; P4-E13): the settings section with its tree, its level switcher and a
 * custom editor's form; the keybinding editor saying a recorded chord would shadow the shell's; the autonomy section
 * with its advisory notice, each over a memory kernel; the inbox with a notice and a confirmation waiting, over a
 * kernel that answers its read; a popover menu, rendered by the overlay layer; and an app's dialog with actions, the
 * shell's prompt and a confirmation, each `loam-modal` shown with what the layer passes it. Specimen renders each in
 * the light, dark and high-contrast contexts (D53); the web package's Chromium suite captures them.
 */

import type { LoamKernel } from '@lushly-dev/loam-kernel';
import type {
	NotificationV1,
	OverlayV1,
	PopoverItemV1,
	PromptSchemaV1,
} from '@lushly-dev/loam-sdk';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import { anchorOwnerOf } from '../dist/apps/anchors.js';
import { defineAppElements, type LoamModal } from '../dist/apps/index.js';
import { ownerLine } from '../dist/apps/overlay-surfaces.js';
import { createPopoverLayer } from '../dist/apps/overlays.js';
import { promptFields } from '../dist/apps/questions.js';
import { LoamInbox } from '../dist/inbox/inbox.js';
import type { LoamShell } from '../dist/index.js';
import { LoamSettingsSection } from '../dist/settings/settings.js';
import { mediaKernel, themePart, until } from './support.js';

type Box = { inline: string; block: string };

/** An element on its own, in a box, once Loam's theme and the app elements are defined. */
function part(
	name: string,
	box: Box,
	render: (wrapper: HTMLElement) => Promise<void>
): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = name;
			wrapper.style.setProperty('inline-size', box.inline);
			wrapper.style.setProperty('block-size', box.block);
			return {
				element: wrapper,
				ready: (async () => {
					await themePart();
					await defineAppElements();
					await render(wrapper);
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					// The theme the document shows once rendered, from the media Specimen set, for the capture to check.
					wrapper.dataset.themeShown = document.documentElement.dataset.loamTheme ?? '';
				})(),
			};
		},
	};
}

/**
 * The settings section on its own, over a memory kernel with Atlas made and active, at `path` (`<section>[/<key>]`), as
 * `syncSettings` shows it in main. It stands alone, as the account section's captures do: in a fixture's shell, main's
 * route is the fixture's own address, which no section claims.
 */
function settingsAt(
	path: string,
	ready: (section: Element) => boolean,
	afterReady?: (section: Element) => Promise<void>
): SpecimenDefinition {
	return part('loam-settings-section', { inline: '1100px', block: '760px' }, async (wrapper) => {
		const { kernel } = await mediaKernel();
		const made = (await kernel.call('project-create', { name: 'Atlas', slug: 'atlas' })) as {
			data: { id: string };
		};
		await kernel.call('scope-set', { project: made.data.id });
		if (!customElements.get('loam-settings-section'))
			customElements.define('loam-settings-section', LoamSettingsSection);
		const section = document.createElement('loam-settings-section') as LoamSettingsSection;
		Object.assign(section, {
			kernel,
			workspace: 'personal',
			project: { id: made.data.id, name: 'Atlas' },
			apps: [],
		});
		wrapper.append(section);
		await section.show(path);
		await until(() => ready(section));
		await afterReady?.(section);
	});
}

/** The keybinding editor in the section, once it has rendered its form. */
const editorOf = (section: Element) =>
	section.shadowRoot?.querySelector('loam-keybinding-editor') as HTMLElement | null | undefined;

/** The settings section at the keybindings' overrides: the tree, the tab list, and the custom editor's form. */
export const SettingsSection = settingsAt('loam.keybindings/overrides', (section) =>
	Boolean(
		section.shadowRoot?.querySelector('[role="tree"] [role="treeitem"]') &&
			section.shadowRoot?.querySelector('[role="tablist"] [role="tab"]') &&
			editorOf(section)?.shadowRoot?.querySelector('form')
	)
);

/**
 * The keybinding editor with a chord recorded that the shell already binds: Mod+B, the sidebar's, for the projects
 * section, said before Add (8.3, 15). The keys are a `keydown` on the Record button, as the editor hears a press.
 */
export const SettingsKeybindingShadowed = settingsAt(
	'loam.keybindings/overrides',
	(section) => Boolean(editorOf(section)?.shadowRoot?.querySelector('#override-record')),
	async (section) => {
		const editor = editorOf(section) as HTMLElement & { mac: boolean };
		const root = editor.shadowRoot as ShadowRoot;
		const fill = (id: string, value: string) => {
			const input = root.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		};
		fill('override-command', 'section-open');
		fill('override-target', 'projects');
		root.querySelector<HTMLElement>('#override-record')?.click();
		await until(
			() => root.querySelector('#override-record')?.getAttribute('aria-pressed') === 'true'
		);
		root.querySelector('#override-record')?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'b',
				code: 'KeyB',
				metaKey: editor.mac,
				ctrlKey: !editor.mac,
				bubbles: true,
				composed: true,
				cancelable: true,
			})
		);
		await until(() =>
			(root.querySelector('#override-said')?.textContent ?? '').includes('would shadow it')
		);
	}
);

/** The autonomy section, its advisory notice first, above every row (P4-E13). */
export const SettingsAutonomy = settingsAt('loam.autonomy', (section) =>
	Boolean(
		section.shadowRoot
			?.querySelector('loam-autonomy-section')
			?.shadowRoot?.querySelector('#autonomy-advisory')
	)
);

const AT = Date.UTC(2026, 10, 20, 9);
const SCOPE = { workspace: 'personal' };

/** The inbox's notices, held to the SDK's own type: a confirmation an agent asked for, waiting, and an app's notice. */
const NOTICES: NotificationV1[] = [
	{
		id: 'ntf_aaaaaaaaaaaaaaaa',
		workspace: 'personal',
		person: 'usr_bea',
		source: 'agent:agt_aaaaaaaaaaaaaaaaaaaa',
		kind: 'confirmation',
		// The kernel titles a confirmation's notice with the command's title, which Confirm and Decline name (7.2, 15).
		title: 'Clear the guest book',
		tone: 'warning',
		confirmation: {
			command: 'hello-clear',
			caller: 'agent:agt_aaaaaaaaaaaaaaaaaaaa',
			input: {},
			header: 'Requested by Claude Code for you',
			prompt: 'Forget every guest and greeting.',
			title: 'Clear the guest book',
			danger: true,
			expiresAt: Date.UTC(2099, 0, 1),
			state: 'pending',
		},
		scope: SCOPE,
		createdAt: AT,
		from: { kind: 'agent', agent: 'Claude Code', person: null },
	},
	{
		id: 'ntf_bbbbbbbbbbbbbbbb',
		workspace: 'personal',
		person: 'usr_bea',
		source: 'hello',
		kind: 'notice',
		title: 'Ada is waiting at the guest book',
		body: 'She arrived a minute ago.',
		tone: 'info',
		action: { command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } },
		scope: SCOPE,
		createdAt: AT - 60_000,
		from: { kind: 'app', title: 'Hello' },
	},
];

/** A kernel that answers the inbox's read from `NOTICES`, and refuses anything else. */
const inboxKernel = {
	call: (name: string) =>
		Promise.resolve(
			name === 'notification-list'
				? { success: true, data: { notifications: NOTICES, cursor: null, unread: 2 } }
				: { success: false, error: { code: 'COMMAND_NOT_FOUND', message: `No ${name} here` } }
		),
	subscribe: () => () => {},
};

/** The inbox, the confirmation first with Confirm and Decline naming the command, then the app's notice (10.3, 7.2). */
export const SettingsInbox = part(
	'loam-inbox',
	{ inline: '960px', block: '720px' },
	async (wrapper) => {
		if (!customElements.get('loam-inbox')) customElements.define('loam-inbox', LoamInbox);
		const inbox = document.createElement('loam-inbox') as LoamInbox;
		Object.assign(inbox, { kernel: inboxKernel, base: '/' });
		wrapper.append(inbox);
		await inbox.show('');
		await until(() => (inbox.shadowRoot?.querySelectorAll('.notice').length ?? 0) === 2);
	}
);

const MENU_ITEMS: PopoverItemV1[] = [
	{ command: 'hello-greet', label: 'Greet Ada', input: { name: 'Ada' } },
	{ command: 'hello-greet', label: 'Greet Bo', input: { name: 'Bo' } },
];

/**
 * An app's popover menu, rendered by the overlay layer itself (`createPopoverLayer`, the `overlays` chunk) from the
 * kernel's overlay, so its `menu` role, its name with the owner line and its items are the layer's, never the fixture's.
 * The layer sits over a stand-in shell, a host with a shadow root holding the anchor, as `loam-shell` holds an app's.
 */
export const SettingsPopoverMenu = part(
	'loam-popover',
	{ inline: '640px', block: '360px' },
	async (wrapper) => {
		const host = document.createElement('div');
		const root = host.attachShadow({ mode: 'open' });
		const anchor = document.createElement('button');
		anchor.type = 'button';
		anchor.textContent = 'Greet';
		root.append(anchor);
		wrapper.append(host);
		const kernel = { call: () => Promise.resolve({ success: true, data: {} }) };
		const layer = createPopoverLayer(
			host as unknown as LoamShell,
			kernel as unknown as LoamKernel,
			() => anchor,
			{
				ownerLine,
				focusFallback: () => {},
				anchorOwnerOf,
				optionsOf: () => ({ kind: 'dialog' }),
				bindAnswer: () => {},
			}
		);
		const overlay: OverlayV1 = {
			overlayId: 'ovl_menu',
			owner: 'hello',
			kind: 'popover',
			lifetime: 'transient',
			from: { kind: 'app', title: 'Hello' },
			input: {
				anchor: { surface: 'main', anchor: 'greet' },
				kind: 'menu',
				label: 'Greet',
				items: MENU_ITEMS,
			},
		};
		layer.render([overlay]);
		await until(() => {
			const menu = root.querySelector('loam-popover');
			return (menu?.shadowRoot?.querySelectorAll('[role="menuitem"]').length ?? 0) === 2;
		});
	}
);

/** A question in `loam-modal`, shown as the overlay layer shows it. */
const question = (show: (element: LoamModal) => Promise<void>) => async (wrapper: HTMLElement) => {
	const element = document.createElement('loam-modal') as LoamModal;
	wrapper.append(element);
	await show(element);
};

/** An app's dialog, non-modal, with its owner line and two actions beside Cancel (6.4). */
export const SettingsDialog = part(
	'loam-modal',
	{ inline: '640px', block: '360px' },
	question((element) =>
		element.show(
			'ovl-1',
			{
				title: 'A card',
				body: 'From the app.',
				actions: [
					{ id: 'later', label: 'Later' },
					{ id: 'keep', label: 'Keep', default: true },
				],
			},
			{ kind: 'dialog', from: 'From Hello' }
		)
	)
);

/** The shell's prompt, aria-modal, with its field (6.5). */
export const SettingsPrompt = part(
	'loam-modal',
	{ inline: '640px', block: '360px' },
	question((element) => {
		const schema: PromptSchemaV1 = { type: 'integer', title: 'Count', minimum: 1, maximum: 9 };
		return element.show(
			'ovl-1',
			{ title: 'How many?', schema },
			{ kind: 'prompt', fields: promptFields(document, schema, undefined) }
		);
	})
);

/**
 * A confirmation in the slot, as the kernel raises it (a prompt with Confirm and Decline) and the overlay layer shows it:
 * its header the dialog's name, its input as it will run, Decline focused (7.2, 15).
 */
export const SettingsConfirmation = part(
	'loam-modal',
	{ inline: '640px', block: '360px' },
	question((element) =>
		element.show(
			'ovl-1',
			{
				title: 'Run Clear the guest book?',
				body: 'Forget every guest and greeting.',
				confirmLabel: 'Confirm',
				cancelLabel: 'Decline',
				danger: true,
			},
			{ kind: 'prompt', asks: 'confirmation', details: 'No input' }
		)
	)
);

/// <reference types="vite/client" />
/**
 * @fileoverview Specimen fixtures for Violet in Loam (spec §7.6, U4):
 * 10 fixtures × 2 densities (`comfortable` and `compact`) = 20 specimens.
 * Rendered in light, dark, and high-contrast themes by `test/specimen.test.ts`.
 */
import type { AppContextV1, DocumentRefV1 } from '@lushly-dev/loam-sdk';
import themeCss from '@lushly-dev/loam-theme/loam-theme.css?inline';
import type { SpecimenDefinition } from '@lushly-dev/specimen';
import '@lushly-dev/violet-elements/badge/define';
import '@lushly-dev/violet-elements/button/define';
import '@lushly-dev/violet-elements/checkbox/define';
import '@lushly-dev/violet-elements/divider/define';
import '@lushly-dev/violet-elements/empty-state/define';
import '@lushly-dev/violet-elements/option/define';
import '@lushly-dev/violet-elements/select/define';
import '@lushly-dev/violet-elements/text-field/define';
import type { EditorViewId } from '../src/elements/editor-views.js';
import {
	defineVioletElements,
	type TokenTreeEditor,
	type TokenTreeInspector,
} from '../src/elements/index.js';

type Density = 'comfortable' | 'compact';

function mediaTheme(): 'light' | 'dark' | 'high-contrast' {
	if (matchMedia('(forced-colors: active)').matches) return 'high-contrast';
	if (matchMedia('(prefers-contrast: more)').matches) return 'high-contrast';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let themed = false;
function applyTheme(density: Density): void {
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

const DOC_REF: DocumentRefV1 = {
	id: 'doc_violet00001',
	type: 'violet-tree',
	title: 'Example tree',
	scope: { workspace: 'personal' },
	contentVersion: 1,
	binding: {
		model: 'command',
		selection: 'item',
		locator: 'item',
		conflict: 'last-writer-wins',
	},
	readOnly: false,
};

const EXAMPLE_NODES = [
	{ id: 'example', parent: null, type: 'product', customizations: 6 },
	{ id: 'example/light', parent: 'example', type: 'theme', customizations: 0 },
	{ id: 'example/dark', parent: 'example', type: 'theme', customizations: 4 },
	{ id: 'example/high-contrast', parent: 'example', type: 'theme', customizations: 3 },
];

const DARK_PREVIEW_PROPERTIES = [
	{ name: '--violet-color-surface-page', value: '#121214' },
	{ name: '--violet-color-surface-card', value: '#1a1a1f' },
	{ name: '--violet-color-surface-subtle', value: '#23232a' },
	{ name: '--violet-color-text-primary', value: '#ececf1' },
	{ name: '--violet-color-text-secondary', value: '#c4c4d0' },
	{ name: '--violet-color-text-muted', value: '#a4a4b2' },
	{ name: '--violet-color-action-primary-background', value: '#5b3fd1' },
	{ name: '--violet-color-action-primary-text', value: '#ffffff' },
	{ name: '--violet-color-action-secondary-background', value: '#26262e' },
	{ name: '--violet-color-action-secondary-border', value: '#525260' },
	{ name: '--violet-color-action-secondary-text', value: '#ececf1' },
	{ name: '--violet-color-field-background', value: '#1a1a1f' },
	{ name: '--violet-color-field-text', value: '#ececf1' },
	{ name: '--violet-color-field-border', value: '#525260' },
	{ name: '--violet-color-field-placeholder', value: '#a4a4b2' },
	{ name: '--violet-color-accent-background', value: '#1e3a52' },
	{ name: '--violet-color-accent-text', value: '#c7e6ff' },
	{ name: '--violet-color-state-success-background', value: '#1b3d2f' },
	{ name: '--violet-color-state-success-text', value: '#c2f0dc' },
	{ name: '--violet-color-control-selected-background', value: '#1b3d2f' },
	{ name: '--violet-color-control-selected-foreground', value: '#c2f0dc' },
	{ name: '--violet-color-control-selected-border', value: '#6cc49e' },
	{ name: '--violet-color-border-strong', value: '#727282' },
	{ name: '--violet-color-border-subtle', value: '#3a3a44' },
	{ name: '--violet-color-focus-ring', value: '#9d8af2' },
	{ name: '--violet-size-focus-ring-width', value: '2px' },
];

const HC_PREVIEW_PROPERTIES = [
	{ name: '--violet-color-surface-page', value: '#ffffff' },
	{ name: '--violet-color-surface-card', value: '#ffffff' },
	{ name: '--violet-color-surface-subtle', value: '#f0f0f2' },
	{ name: '--violet-color-text-primary', value: '#000000' },
	{ name: '--violet-color-text-secondary', value: '#1b1b1f' },
	{ name: '--violet-color-text-muted', value: '#3d3d45' },
	{ name: '--violet-color-action-primary-background', value: '#1d1070' },
	{ name: '--violet-color-action-primary-text', value: '#ffffff' },
	{ name: '--violet-color-action-secondary-background', value: '#ffffff' },
	{ name: '--violet-color-action-secondary-border', value: '#000000' },
	{ name: '--violet-color-action-secondary-text', value: '#000000' },
	{ name: '--violet-color-field-background', value: '#ffffff' },
	{ name: '--violet-color-field-text', value: '#000000' },
	{ name: '--violet-color-field-border', value: '#000000' },
	{ name: '--violet-color-field-placeholder', value: '#3d3d45' },
	{ name: '--violet-color-accent-background', value: '#e2edf5' },
	{ name: '--violet-color-accent-text', value: '#0c3f66' },
	{ name: '--violet-color-state-success-background', value: '#dfeae3' },
	{ name: '--violet-color-state-success-text', value: '#184232' },
	{ name: '--violet-color-control-selected-background', value: '#1d1070' },
	{ name: '--violet-color-control-selected-foreground', value: '#ffffff' },
	{ name: '--violet-color-control-selected-border', value: '#000000' },
	{ name: '--violet-color-border-strong', value: '#000000' },
	{ name: '--violet-color-border-subtle', value: '#3d3d45' },
	{ name: '--violet-color-focus-ring', value: '#1d1070' },
	{ name: '--violet-size-focus-ring-width', value: '3px' },
];

function stubContext(): AppContextV1 {
	return {
		instance: 'violet',
		app: 'violet',
		version: '0.1.0',
		config: {},
		registry: customElements,
		kit: { define: async () => {} },
		overlays: {} as AppContextV1['overlays'],
		documents: {
			get: async () => null,
			list: async () => [
				{
					id: 'doc_violet00002',
					title: 'Partner tree',
					type: 'violet-tree',
					status: 'active',
				} as never,
			],
			links: async () => ({ out: [], in: [] }),
			open: async () => {},
		},
		client: {
			call: async (name: string, input?: unknown) => {
				const args = (input ?? {}) as Record<string, unknown>;
				switch (name) {
					case 'violet-node-list':
						return {
							success: true,
							data: { root: 'example', nodes: EXAMPLE_NODES, unexported: 0 },
						} as never;
					case 'violet-node-get':
						return {
							success: true,
							data: {
								node: { id: 'example/dark', parent: 'example', type: 'theme' },
								own: [
									{ token: 'color.surface.page', operation: 'override', value: '#121214' },
									{ token: 'color.text.primary', operation: 'override', value: '#ececf1' },
									{ token: 'color.text.muted', operation: 'override', value: '#9a9aa6' },
									{ token: 'color.field.border', operation: 'override', value: '#3a3a44' },
								],
							},
						} as never;
					case 'violet-token-resolve':
						return {
							success: true,
							data: {
								node: 'example/dark',
								total: 6,
								truncated: false,
								tokens: [
									{ id: 'color.action.primary.background', value: '#5b3fd1', from: 'example' },
									{ id: 'color.field.border', value: '#3a3a44', from: 'example/dark' },
									{ id: 'color.surface.page', value: '#121214', from: 'example/dark' },
									{ id: 'color.text.muted', value: '#9a9aa6', from: 'example/dark' },
									{ id: 'color.text.primary', value: '#ececf1', from: 'example/dark' },
									{ id: 'size.focus-ring.width', value: '2px', from: 'example' },
								],
							},
						} as never;
					case 'violet-token-compare':
						return {
							success: true,
							data: {
								nodes: ['example/light', 'example/dark', 'example/high-contrast'],
								summary: { differing: 2 },
								rows: [
									{
										token: 'color.text.muted',
										cells: [
											{ node: 'example/light', value: '#6b6b75', differs: false },
											{ node: 'example/dark', value: '#9a9aa6', differs: true },
											{ node: 'example/high-contrast', value: '#3d3d45', differs: true },
										],
									},
									{
										token: 'color.text.primary',
										cells: [
											{ node: 'example/light', value: '#1b1b1f', differs: false },
											{ node: 'example/dark', value: '#ececf1', differs: true },
											{ node: 'example/high-contrast', value: '#000000', differs: true },
										],
									},
								],
							},
						} as never;
					case 'violet-tree-compare':
						return {
							success: true,
							data: {
								summary: { differing: 1, onlyHere: 1, onlyThere: 0 },
								rows: [
									{ token: 'color.surface.page', here: '#121214', there: '#0e0e10' },
									{ token: 'color.text.muted', here: '#9a9aa6', there: null },
								],
							},
						} as never;
					case 'violet-theme-preview': {
						const node = String(args.node ?? 'example/dark');
						const properties =
							node === 'example/high-contrast' ? HC_PREVIEW_PROPERTIES : DARK_PREVIEW_PROPERTIES;
						return {
							success: true,
							data: { node, count: properties.length, properties, refused: [] },
						} as never;
					}
					case 'violet-violation-list':
						return {
							success: true,
							data: {
								summary: { total: 1, errors: 1 },
								violations: [
									{
										node: 'example/high-contrast',
										token: 'color.text.muted',
										rule: 'text-on-page-hc',
										severity: 'error',
										ratio: 5.21,
										min: 7,
									},
								],
							},
						} as never;
					case 'violet-interface-check':
						return {
							success: true,
							data: {
								interface: { version: 1 },
								complete: false,
								nodes: ['example/light', 'example/dark', 'example/high-contrast'],
								missing: [
									{
										node: 'example/light',
										token: 'color.action.danger.background',
										reason: 'not defined',
									},
									{
										node: 'example/dark',
										token: 'color.action.danger.background',
										reason: 'not defined',
									},
									{
										node: 'example/high-contrast',
										token: 'color.action.danger.background',
										reason: 'not defined',
									},
								],
								invalid: [
									{
										node: 'example/dark',
										token: 'size.focus-ring.width',
										type: 'dimension',
										problem: 'expected dimension value',
									},
								],
								leaked: [{ token: 'ref.palette.neutral.50', reason: 'global-tier' }],
							},
						} as never;
					case 'violet-change-list':
						return {
							success: true,
							data: {
								total: 3,
								changes: [
									{
										node: 'example/high-contrast',
										token: 'color.text.muted',
										operation: 'override',
										oldValue: '#6b6b75',
										value: '#3d3d45',
										reason: 'Meet 7:1 high-contrast floor',
										actor: 'local',
										at: '2026-11-23T10:00:00.000Z',
									},
									{
										node: 'example/dark',
										token: 'color.action.primary.background',
										operation: 'override',
										oldValue: '#5b3fd1',
										value: '#7a63e6',
										reason: 'Lift primary button contrast on dark surface',
										actor: 'local',
										at: '2026-11-23T09:50:00.000Z',
									},
									{
										node: 'example',
										token: 'color.action.danger.background',
										operation: 'add',
										oldValue: null,
										value: '#b3261e',
										reason: 'Fill component interface danger slot',
										actor: 'local',
										at: '2026-11-23T09:40:00.000Z',
									},
								],
							},
						} as never;
					case 'violet-token-lineage':
						return {
							success: true,
							data: {
								token: 'color.text.primary',
								value: '#ececf1',
								from: 'example/dark',
								chain: [
									{ node: 'example', operation: 'add', value: '#1b1b1f' },
									{ node: 'example/dark', operation: 'override', value: '#ececf1' },
								],
							},
						} as never;
					case 'violet-change-preview':
						return {
							success: true,
							data: {
								written: false,
								summary: { changed: 2, shielded: 1, violationsIntroduced: 0 },
								nodes: [{ id: 'example/dark', effect: 'changes', violationsIntroduced: 0 }],
								apply: {
									command: 'violet-change-apply',
									input: {
										document: DOC_REF.id,
										node: 'example/dark',
										changes: args.changes ?? [],
										expectedRev: 1,
									},
								},
							},
						} as never;
					default:
						return { success: true, data: {} } as never;
				}
			},
		},
	};
}

async function waitFrame(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 60));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function editorFixture(
	density: Density,
	options: {
		name: string;
		view: EditorViewId;
		node: string;
		selectedToken?: string;
		compareMode?: 'nodes' | 'trees';
		scopedFrame?: boolean;
	}
): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = options.name;
			wrapper.style.setProperty('inline-size', '100%');
			wrapper.style.setProperty('block-size', '720px');
			if (options.scopedFrame) {
				wrapper.style.setProperty('display', 'grid');
				wrapper.style.setProperty('grid-template-columns', 'minmax(0, 1fr) 280px');
			}
			return {
				element: wrapper,
				ready: (async () => {
					applyTheme(density);
					const context = stubContext();
					if (!customElements.get('token-tree-editor')) await defineVioletElements(context);
					const editor = document.createElement('token-tree-editor') as TokenTreeEditor;
					editor.context = context;
					editor.document = DOC_REF;
					editor.activeView = options.view;
					editor.selectedNode = options.node;
					if (options.selectedToken) editor.selectedToken = options.selectedToken;
					if (options.compareMode) {
						editor.compareMode = options.compareMode;
						editor.otherDocument = 'doc_violet00002';
						editor.otherNode = 'example/dark';
					}
					wrapper.append(editor);

					let inspector: TokenTreeInspector | null = null;
					if (options.scopedFrame) {
						inspector = document.createElement('token-tree-inspector') as TokenTreeInspector;
						inspector.context = context;
						inspector.document = DOC_REF;
						inspector.selection = null;
						wrapper.append(inspector);
					}
					await waitFrame();

					if (options.scopedFrame && inspector) {
						const probe = document.createElement('div');
						probe.style.setProperty('background-color', 'var(--violet-color-surface-card)');
						wrapper.append(probe);
						const expectedCardBg = getComputedStyle(probe).backgroundColor;
						probe.remove();
						const nodesCol = editor.shadowRoot?.querySelector<HTMLElement>('.nodes-column');
						const previewRoot =
							editor.shadowRoot?.querySelector<HTMLElement>('[data-preview-root]');
						wrapper.dataset.expectedCardBg = expectedCardBg;
						wrapper.dataset.nodesColBg = nodesCol ? getComputedStyle(nodesCol).backgroundColor : '';
						wrapper.dataset.inspectorBg = getComputedStyle(inspector).backgroundColor;
						wrapper.dataset.previewPageProp = previewRoot
							? getComputedStyle(previewRoot).getPropertyValue('--violet-color-surface-page').trim()
							: '';
						wrapper.dataset.docRootOverride = document.documentElement.style
							.getPropertyValue('--violet-color-surface-page')
							.trim();
					}
				})(),
			};
		},
	};
}

function inspectorFixture(density: Density, populated: boolean): SpecimenDefinition {
	return {
		render: () => {
			const wrapper = document.createElement('div');
			wrapper.dataset.fixture = populated ? 'violet-inspector' : 'violet-inspector-empty';
			wrapper.style.setProperty('inline-size', '100%');
			wrapper.style.setProperty('max-inline-size', '360px');
			wrapper.style.setProperty('block-size', '560px');
			return {
				element: wrapper,
				ready: (async () => {
					applyTheme(density);
					const context = stubContext();
					if (!customElements.get('token-tree-inspector')) await defineVioletElements(context);
					const inspector = document.createElement('token-tree-inspector') as TokenTreeInspector;
					inspector.context = context;
					inspector.document = DOC_REF;
					inspector.selection = populated ? 'example/dark#color.text.primary' : null;
					wrapper.append(inspector);
					await waitFrame();
					if (populated) {
						await inspector.stageChange('#f6f6fb');
						await waitFrame();
					}
				})(),
			};
		},
	};
}

export const [Tokens, TokensCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-tokens',
		view: 'tokens',
		node: 'example/dark',
		selectedToken: 'color.text.primary',
	})
);

export const [Compare, CompareCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-compare',
		view: 'compare',
		node: 'example/dark',
		compareMode: 'nodes',
	})
);

export const [CompareTrees, CompareTreesCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-compare-trees',
		view: 'compare',
		node: 'example/dark',
		compareMode: 'trees',
	})
);

export const [Preview, PreviewCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-preview',
		view: 'preview',
		node: 'example/high-contrast',
	})
);

export const [PreviewScoped, PreviewScopedCompact] = (['comfortable', 'compact'] as const).map(
	(d) =>
		editorFixture(d, {
			name: 'violet-preview-scoped',
			view: 'preview',
			node: 'example/dark',
			scopedFrame: true,
		})
);

export const [Checks, ChecksCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-checks',
		view: 'checks',
		node: 'example/dark',
	})
);

export const [History, HistoryCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-history',
		view: 'history',
		node: 'example/dark',
	})
);

export const [Sidebar, SidebarCompact] = (['comfortable', 'compact'] as const).map((d) =>
	editorFixture(d, {
		name: 'violet-sidebar',
		view: 'tokens',
		node: 'example/dark',
	})
);

export const [Inspector, InspectorCompact] = (['comfortable', 'compact'] as const).map((d) =>
	inspectorFixture(d, true)
);

export const [InspectorEmpty, InspectorEmptyCompact] = (['comfortable', 'compact'] as const).map(
	(d) => inspectorFixture(d, false)
);

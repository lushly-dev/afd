/**
 * @lushly-dev/loam-chrome: the shell parts as FAST-AF elements, the palette, keyboard, the layout
 * classes, the router and theme application (phase 0 specification,
 * endpoints/loam/docs/phases/0-kernel-chrome/spec.md, sections 5 and 7). It binds to the kernel
 * only through `LoamKernelV2`.
 */

export {
	CHROME_ELEMENTS,
	defineChrome,
	defineNotice,
	definePalette,
	type MountShellOptions,
	mountShell,
	type NoticeOptions,
	renderNotice,
} from './define.js';
export {
	APP_OPEN_EVENT,
	LoamAppEntry,
	LoamSectionEntry,
	SECTION_OPEN_EVENT,
} from './elements/app-entry.js';
export { LoamAppNav, LoamRail, LoamTabbar, SETTINGS_TOOLTIP } from './elements/app-nav.js';
export { LoamEmptyState } from './elements/empty-state.js';
export { ACTION_EVENT, type ChromeAction } from './elements/events.js';
export { LoamMain } from './elements/main.js';
// As the palette's: it loads when one is needed (defineNotice).
export type { LoamNotice } from './elements/notice.js';
// The palette's class stays out of the root graph: it loads after first paint (definePalette).
export type {
	LoamPalette,
	PaletteFailure,
	PaletteHost,
	PaletteResult,
} from './elements/palette.js';
export { LoamPanel } from './elements/panel.js';
export { LoamProjectSwitcher, SWITCHER_OPEN_EVENT } from './elements/project-switcher.js';
export type { LoamResizeHandle } from './elements/resize-handle.js';
export {
	type JournalReader,
	LoamShell,
	MOCK_SIGN_IN_EMAIL,
	type ShellApps,
} from './elements/shell.js';
export { LoamInspector, LoamSidebar, LoamSidePart } from './elements/side-part.js';
export { LoamStatusItem } from './elements/status-item.js';
export { LoamStatusbar } from './elements/statusbar.js';
export { LoamTitlebar } from './elements/titlebar.js';
// As the palette's: it loads when one is needed (7.5).
export type { LoamTooltip, TipTarget } from './elements/tooltip.js';
export {
	type ChordEvent,
	chordMatches,
	isMacPlatform,
	matchKeybinding,
	nextPart,
	PART_ORDER,
	type PartName,
	toggleInput,
} from './keyboard.js';
export {
	LAYOUT_CLASS_QUERIES,
	type LayoutClass,
	layoutClassFor,
	type PanelMode,
	type PresentationV0,
	type PresentOptions,
	presentLayout,
	type SideMode,
} from './layout-class.js';
export { bandFor, dimmedTip, type RailBand, type RailPlacement, railOrder } from './rail/bands.js';
export {
	clampSize,
	DRAG_THRESHOLD,
	HANDLE_STEP,
	type HandleGrowth,
	nextPreset,
	type ResizeDetail,
} from './resize.js';
export { formatRoute } from './route-format.js';
export { createRouter, parseRoute, type RouterV1, type RouteV1, STATE_INFO } from './router.js';
export { STATE_PROPERTIES, type StateProperty } from './state-properties.js';
export { applyAppearance, applyThemeStylesheet, displayedTheme, documentStyles } from './theme.js';

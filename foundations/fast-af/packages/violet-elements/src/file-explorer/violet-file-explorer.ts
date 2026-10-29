import { FASTElement, Updates, attr, css, html, observable, repeat, when } from "@lushly-dev/fast-element";
import type { ViewTemplate } from "@lushly-dev/fast-element";

import "../breadcrumb-item/violet-breadcrumb-item";
import "../breadcrumb/violet-breadcrumb";
import "../button/violet-button";
import "../empty-state/violet-empty-state";
import { registerSystemDocumentIcon, registerSystemFolderIcon } from "../icon/generated";
import "../icon/violet-icon";
import "../spinner/violet-spinner";
import { violetFieldTokenDefaults, violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import "../tree-item/violet-tree-item";
import "../tree/violet-tree";
import type { VioletTree } from "../tree/violet-tree";

registerSystemFolderIcon();
registerSystemDocumentIcon();

/** Whether an explorer item is a folder (navigable) or a file (activatable). */
export type VioletFileExplorerItemKind = "file" | "folder";

/** Selection behaviour of the file listing. */
export type VioletFileExplorerSelectionMode = "none" | "single" | "multiple";

/**
 * One host-supplied file or folder. The model is flat: `parentId` links an item to its folder, so a
 * host can add the contents of a lazily loaded folder by appending items and flipping `loaded`.
 */
export interface VioletFileExplorerItem {
    /** Stable, unique identifier. Never derive it from the display name. */
    id: string;
    /** Display name. */
    name: string;
    kind: VioletFileExplorerItemKind;
    /** Id of the containing folder; omit, `null` or `""` for the top level. */
    parentId?: string | null;
    /**
     * Folders only. `false` means the folder's contents have not been supplied yet: the explorer shows it as
     * expandable, shows a loading state while it is open and emits `folder-request`. Defaults to `true`.
     */
    loaded?: boolean;
    /** Optional trailing metadata text such as a size or modified date. */
    meta?: string;
    /** Optional registered `violet-icon` name overriding the default folder/document glyph. */
    icon?: string;
    /** Disabled items stay visible and focusable but cannot be selected or activated. */
    disabled?: boolean;
}

export type VioletFileExplorerFolderRequestReason = "expand" | "navigate" | "retry";

export interface VioletFileExplorerFolderChangeDetail {
    /** The folder now shown, or `null` for the top level. */
    folderId: string | null;
    /** Folder ids from the top level to `folderId`, inclusive; empty at the top level. */
    path: string[];
}

export interface VioletFileExplorerFolderRequestDetail {
    /** The folder whose contents the host should supply, or `null` for the top level (retry only). */
    folderId: string | null;
    reason: VioletFileExplorerFolderRequestReason;
}

export interface VioletFileExplorerSelectionChangeDetail {
    selectedIds: string[];
    items: VioletFileExplorerItem[];
}

export interface VioletFileExplorerItemActivateDetail {
    id: string;
    kind: VioletFileExplorerItemKind;
    item: VioletFileExplorerItem;
}

const ROOT_VALUE = "__violet-file-explorer-root__";

class FolderNode {
    @observable declare public value: string;
    @observable declare public name: string;
    @observable declare public expanded: boolean;
    @observable declare public expandable: boolean;
    @observable declare public children: FolderNode[];

    public constructor(value: string) {
        this.value = value;
        this.name = "";
        this.expanded = false;
        this.expandable = false;
        this.children = [];
    }
}

class Crumb {
    @observable declare public id: string;
    @observable declare public name: string;

    public constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
    }
}

class Row {
    @observable declare public id: string;
    @observable declare public name: string;
    @observable declare public kind: VioletFileExplorerItemKind;
    @observable declare public meta: string;
    @observable declare public icon: string;
    @observable declare public selected: boolean;
    @observable declare public disabled: boolean;
    @observable declare public active: boolean;

    public constructor(id: string) {
        this.id = id;
        this.name = "";
        this.kind = "file";
        this.meta = "";
        this.icon = "";
        this.selected = false;
        this.disabled = false;
        this.active = false;
    }

    public get accessibleName(): string {
        return [this.name, this.kind === "folder" ? "folder" : "", this.meta].filter(Boolean).join(", ");
    }
}

const styles = css`
    ${violetFieldTokenDefaults}
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        container-type: inline-size;
        block-size: var(--violet-file-explorer-block-size, 24rem);
        min-inline-size: 0;

        --_explorer-nav-size: var(--violet-file-explorer-nav-inline-size, 14rem);
        --_explorer-radius: var(--violet-file-explorer-radius, var(--_radius-lg));
        --_explorer-padding: var(--violet-file-explorer-padding, var(--_space-stack-sm));
        --_row-radius: var(--violet-file-explorer-row-radius, var(--_radius-md));
        --_row-background-hover: var(--violet-file-explorer-row-background-hover, var(--_surface-subtle));
        --_row-background-selected: var(--violet-file-explorer-row-background-selected, var(--_surface-hover));
        --_row-border-selected: var(--violet-file-explorer-row-border-selected, var(--_border-subtle));
        --_danger-text: var(--color-state-danger-foreground, #b42318);
    }

    .explorer {
        box-sizing: border-box;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        block-size: 100%;
        min-block-size: 0;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_explorer-radius);
        background: var(--_surface-card);
        overflow: hidden;
    }

    .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-inline-md);
        padding: var(--_space-stack-xs) var(--_explorer-padding);
        border-block-end: 1px solid var(--_border-subtle);
        min-block-size: var(--_target-size);
    }

    .actions {
        display: flex;
        align-items: center;
        gap: var(--_space-inline-md);
        margin-inline-start: auto;
    }

    .body {
        display: grid;
        grid-template-columns: minmax(8rem, var(--_explorer-nav-size)) minmax(0, 1fr);
        min-block-size: 0;
    }

    violet-tree {
        --violet-tree-row-background-selected: var(--_row-background-selected);
        --violet-tree-row-background-hover: var(--_row-background-hover);
        --violet-tree-row-border-selected: var(--_row-border-selected);
    }

    .nav {
        min-inline-size: 0;
        min-block-size: 0;
        overflow: auto;
        padding: var(--_space-stack-xs);
        border-inline-end: 1px solid var(--_border-subtle);
    }

    .content {
        position: relative;
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
        min-block-size: 0;
        overflow: auto;
        padding: var(--_space-stack-xs);
        outline: none;
    }

    .list {
        display: grid;
        gap: 0;
        outline: none;
    }

    .row {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-md);
        min-block-size: var(--_target-size);
        padding-block: var(--_space-stack-2xs);
        padding-inline: var(--_space-inline-md);
        border-radius: var(--_row-radius);
        color: var(--_text-primary);
        cursor: pointer;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
        user-select: none;
        transition:
            background-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-fast) var(--_easing-standard);
    }

    .row:hover {
        background: var(--_row-background-hover);
    }

    .row[aria-selected="true"] {
        background: var(--_row-background-selected);
        box-shadow: inset 0 0 0 1px var(--_row-border-selected);
    }

    .row:focus-visible {
        box-shadow: inset 0 0 0 2px var(--_focus-ring);
    }

    .row[aria-selected="true"]:focus-visible {
        box-shadow:
            inset 0 0 0 1px var(--_row-border-selected),
            inset 0 0 0 3px var(--_focus-ring);
    }

    .row[aria-disabled="true"] {
        color: var(--_text-muted);
        cursor: not-allowed;
        opacity: 0.75;
    }

    .row-icon {
        --violet-icon-size: 1.125rem;
        color: var(--_text-secondary);
    }

    .name {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .meta {
        color: var(--_text-secondary);
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        white-space: nowrap;
    }

    .state {
        display: grid;
        flex: 1;
        place-content: center;
        justify-items: center;
        gap: var(--_space-stack-sm);
        padding: var(--_space-stack-sm);
        color: var(--_text-secondary);
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        text-align: center;
    }

    .state.loading {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        gap: var(--_space-inline-md);
    }

    .state.loading:only-child {
        flex: 1;
    }

    .error-message {
        margin: 0;
        color: var(--_danger-text);
    }

    .footer {
        padding: var(--_space-stack-xs) var(--_explorer-padding);
        border-block-start: 1px solid var(--_border-subtle);
    }

    .footer[hidden] {
        display: none;
    }

    .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    @container (max-width: 34rem) {
        .body {
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: minmax(0, auto) minmax(0, 1fr);
        }

        .nav {
            max-block-size: 8rem;
            border-inline-end: 0;
            border-block-end: 1px solid var(--_border-subtle);
        }
    }

    @media (forced-colors: active) {
        .explorer {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: CanvasText;
        }

        .row {
            forced-color-adjust: none;
            color: CanvasText;
        }

        .row[aria-selected="true"] {
            background: Canvas;
            box-shadow: inset 0 0 0 2px Highlight;
        }

        .row:focus-visible {
            box-shadow: inset 0 0 0 2px Highlight;
            outline: 2px solid Highlight;
        }
    }
`;

const folderNodeTemplate: ViewTemplate<FolderNode, FolderNode> = html<FolderNode, FolderNode>`
    <violet-tree-item
        value="${x => x.value}"
        ?expanded="${x => x.expanded}"
        ?expandable="${x => x.expandable}"
    >
        <violet-icon slot="start" icon="system/folder" decorative></violet-icon>
        ${x => x.name}
        ${repeat(
            x => x.children,
            (_x, _c) => folderNodeTemplate,
            { recycle: false },
        )}
    </violet-tree-item>
`;

const crumbTemplate = html<Crumb, VioletFileExplorer>`
    <violet-breadcrumb-item
        href="#"
        data-folder-id="${x => x.id}"
        @click="${(x, c) => c.parent.handleCrumbClick(x, c.event as MouseEvent)}"
    >
        ${x => x.name}
    </violet-breadcrumb-item>
`;

const rowTemplate = html<Row, VioletFileExplorer>`
    <div
        class="row"
        part="row"
        role="option"
        data-item-id="${x => x.id}"
        data-kind="${x => x.kind}"
        tabindex="${x => (x.active ? "0" : "-1")}"
        aria-label="${x => x.accessibleName}"
        aria-selected="${(x, c) => (c.parent.selectionMode === "none" ? null : String(x.selected))}"
        aria-disabled="${x => (x.disabled ? "true" : null)}"
        @click="${(x, c) => c.parent.handleRowClick(x, c.event as MouseEvent)}"
        @dblclick="${(x, c) => c.parent.handleRowDoubleClick(x)}"
    >
        <violet-icon
            class="row-icon"
            part="row-icon"
            icon="${x => x.icon}"
            decorative
        ></violet-icon>
        <span class="name" part="name">${x => x.name}</span>
        <span class="meta" part="meta">${x => x.meta}</span>
    </div>
`;

const template = html<VioletFileExplorer>`
    <div class="explorer" part="explorer" role="group" aria-label="${x => x.label || "File explorer"}">
        <div class="toolbar" part="toolbar">
            <violet-breadcrumb part="breadcrumb" label="Folder path">
                ${repeat(x => x.crumbs, crumbTemplate, { recycle: false })}
            </violet-breadcrumb>
            <div class="actions" part="actions">
                <slot name="actions"></slot>
            </div>
        </div>
        <div class="body" part="body">
            <div class="nav" part="navigation">
                <violet-tree
                    part="tree"
                    aria-label="Folders"
                    value="${x => x.treeValue}"
                    @change="${(x, c) => x.handleTreeChange(c.event as CustomEvent)}"
                    @expanded-change="${(x, c) => x.handleTreeExpandedChange(c.event as CustomEvent)}"
                >
                    ${repeat(x => x.folderTree, folderNodeTemplate as unknown as ViewTemplate<FolderNode, VioletFileExplorer>, { recycle: false })}
                </violet-tree>
            </div>
            <div
                class="content"
                part="content"
                tabindex="-1"
                aria-busy="${x => (x.isLoading ? "true" : "false")}"
            >
                ${when(
                    x => x.isLoading,
                    html<VioletFileExplorer>`
                        <div class="state loading" part="loading-state" role="status">
                            <violet-spinner size="sm" label="Loading folder contents"></violet-spinner>
                            <span>Loading…</span>
                        </div>
                    `,
                )}
                ${when(
                    x => Boolean(x.loadError),
                    html<VioletFileExplorer>`
                        <div class="state" part="error-state" role="alert">
                            <p class="error-message" part="error-text">${x => x.loadError}</p>
                            <violet-button appearance="secondary" @click="${x => x.handleRetry()}">
                                Try again
                            </violet-button>
                        </div>
                    `,
                )}
                ${when(
                    x => x.isEmpty,
                    html<VioletFileExplorer>`
                        <div class="state" part="empty-state">
                            <slot name="empty">
                                <violet-empty-state
                                    heading="This folder is empty"
                                    appearance="plain"
                                ></violet-empty-state>
                            </slot>
                        </div>
                    `,
                )}
                ${when(
                    x => x.rows.length > 0 && !x.loadError,
                    html<VioletFileExplorer>`
                        <div
                            class="list"
                            part="list"
                            role="listbox"
                            aria-label="${x => x.listLabel}"
                            aria-multiselectable="${x => (x.selectionMode === "multiple" ? "true" : null)}"
                            @keydown="${(x, c) => x.handleListKeydown(c.event as KeyboardEvent)}"
                            @focusin="${(x, c) => x.handleListFocusIn(c.event as FocusEvent)}"
                        >
                            ${repeat(x => x.rows, rowTemplate, { recycle: false })}
                        </div>
                    `,
                )}
            </div>
        </div>
        <div class="footer" part="footer" ?hidden="${x => !x.hasFooter}">
            <slot name="footer" @slotchange="${(x, c) => x.handleFooterSlotChange(c.event)}"></slot>
        </div>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">${x => x.statusMessage}</div>
    </div>
`;

/**
 * Violet file explorer.
 *
 * @summary Host-driven file browser composed from `violet-tree` (folder navigation), `violet-breadcrumb` (path) and a
 * selectable file listing, with separate selection and activation, lazy folder loading and loading, empty and error
 * states. The host owns the data and every business operation; the component owns interaction and presentation.
 * @fires folder-change - Emitted when the user navigates to another folder; detail is `{ folderId, path }`.
 * @fires folder-request - Emitted when the host should supply (or re-supply) a folder's contents; detail is
 * `{ folderId, reason }` where reason is `expand`, `navigate` or `retry`.
 * @fires selection-change - Emitted when the user changes the selection; detail is `{ selectedIds, items }`.
 * @fires item-activate - Cancelable. Emitted when the user activates an item (Enter, double-click, or a single click when
 * `selection-mode="none"`); detail is `{ id, kind, item }`. Activating a folder navigates into it unless prevented.
 * @slot actions - Host actions rendered at the end of the toolbar.
 * @slot empty - Replaces the default empty-folder message.
 * @slot footer - Optional host content under the explorer, such as an upload control.
 * @csspart explorer - Outer frame.
 * @csspart toolbar - Breadcrumb and actions bar.
 * @csspart breadcrumb - Folder path.
 * @csspart actions - Wrapper of the actions slot.
 * @csspart body - Navigation and content region.
 * @csspart navigation - Folder tree wrapper.
 * @csspart tree - Folder tree.
 * @csspart content - Scrollable content region.
 * @csspart list - File listing.
 * @csspart row - A file or folder row.
 * @csspart row-icon - Row glyph.
 * @csspart name - Row name.
 * @csspart meta - Row metadata.
 * @csspart loading-state - Loading indicator.
 * @csspart error-state - Error message and retry action.
 * @csspart error-text - Error message text.
 * @csspart empty-state - Empty-folder wrapper.
 * @csspart footer - Footer slot wrapper.
 */
export class VioletFileExplorer extends FASTElement {
    @observable
    declare public items: VioletFileExplorerItem[];

    @observable
    declare public selectedIds: string[];

    @observable
    declare public crumbs: Crumb[];

    @observable
    declare public folderTree: FolderNode[];

    @observable
    declare public rows: Row[];

    @observable
    declare public statusMessage: string;

    @observable
    declare public isLoading: boolean;

    @observable
    declare public isEmpty: boolean;

    @observable
    declare public treeValue: string;

    @observable
    declare public listLabel: string;

    @observable
    declare public hasFooter: boolean;

    declare public currentFolderId: string;
    declare public rootLabel: string;
    declare public selectionMode: VioletFileExplorerSelectionMode;
    declare public busy: boolean;
    declare public loadError: string;
    declare public label: string;

    #connected = false;
    #expandedIds = new Set<string>([""]);
    #requested = new Set<string>();
    #rowCache = new Map<string, Row>();
    #nodeCache = new Map<string, FolderNode>();
    #crumbCache = new Map<string, Crumb>();
    #activeRowId = "";
    #anchorId = "";
    #pendingFocus: { kind: "first" } | { kind: "id"; id: string } | null = null;
    #lastAnnouncement = "";
    #rebuildQueued = false;

    public constructor() {
        super();
        this.items = [];
        this.selectedIds = [];
        this.crumbs = [];
        this.folderTree = [];
        this.rows = [];
        this.statusMessage = "";
        this.isLoading = false;
        this.isEmpty = false;
        this.treeValue = ROOT_VALUE;
        this.listLabel = "Folder contents";
        this.hasFooter = false;
        this.currentFolderId = "";
        this.rootLabel = "Files";
        this.selectionMode = "single";
        this.busy = false;
        this.loadError = "";
        this.label = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#connected = true;
        this.#rebuild();
        this.#requestIfUnloaded(this.currentFolderId, "navigate");
    }

    public disconnectedCallback(): void {
        this.#connected = false;
        super.disconnectedCallback();
    }

    public itemsChanged(): void {
        for (const id of [...this.#requested]) {
            const item = this.#findItem(id);
            if (!item || item.loaded !== false) {
                this.#requested.delete(id);
            }
        }
        this.#queueRebuild();
    }

    public selectedIdsChanged(): void {
        this.#queueRebuild();
    }

    public currentFolderIdChanged(): void {
        if (!this.#connected) {
            return;
        }

        this.#expandAncestors(this.currentFolderId);
        this.#queueRebuild();
        this.#requestIfUnloaded(this.currentFolderId, "navigate");
    }

    public rootLabelChanged(): void {
        this.#queueRebuild();
    }

    public selectionModeChanged(): void {
        this.#queueRebuild();
    }

    public busyChanged(): void {
        this.#queueRebuild();
    }

    public loadErrorChanged(): void {
        this.#queueRebuild();
    }

    /** Moves focus into the file listing (the active row), or the content region when there are no rows. */
    public focusList(): void {
        this.#focusActiveRow();
    }

    public handleFooterSlotChange(event: Event): void {
        this.hasFooter = (event.target as HTMLSlotElement).assignedNodes().length > 0;
    }

    public handleCrumbClick(crumb: Crumb, _event: MouseEvent): void {
        this.#navigate(crumb.id, { kind: "first" });
    }

    public handleTreeChange(event: CustomEvent<{ value: string }>): void {
        event.stopPropagation();
        const value = event.detail?.value;
        if (typeof value !== "string") {
            return;
        }

        this.#navigate(value === ROOT_VALUE ? "" : value, null);
    }

    public handleTreeExpandedChange(event: CustomEvent<{ value: string; expanded: boolean }>): void {
        event.stopPropagation();
        const { value, expanded } = event.detail ?? {};
        if (typeof value !== "string") {
            return;
        }

        const folderId = value === ROOT_VALUE ? "" : value;
        if (expanded) {
            this.#expandedIds.add(folderId);
            this.#requestIfUnloaded(folderId, "expand");
        } else {
            this.#expandedIds.delete(folderId);
        }

        const node = this.#nodeCache.get(folderId);
        if (node) {
            node.expanded = expanded;
        }
    }

    public handleRetry(): void {
        this.#requested.delete(this.currentFolderId);
        this.#emitFolderRequest(this.currentFolderId, "retry");
    }

    public handleRowClick(row: Row, event: MouseEvent): void {
        if (row.disabled) {
            return;
        }

        this.#setActiveRow(row.id);

        if (this.selectionMode === "none") {
            this.#activate(row.id);
            return;
        }

        if (this.selectionMode === "multiple" && event.shiftKey && this.#anchorId) {
            this.#selectRange(this.#anchorId, row.id);
            return;
        }

        if (this.selectionMode === "multiple" && (event.ctrlKey || event.metaKey)) {
            this.#toggleSelection(row.id);
            return;
        }

        this.#anchorId = row.id;
        this.#setSelection([row.id]);
    }

    public handleRowDoubleClick(row: Row): void {
        if (row.disabled || this.selectionMode === "none") {
            return;
        }

        this.#activate(row.id);
    }

    public handleListFocusIn(event: FocusEvent): boolean {
        const id = this.#rowIdFromEvent(event);
        if (id) {
            this.#setActiveRow(id);
        }
        return true;
    }

    public handleListKeydown(event: KeyboardEvent): boolean {
        const id = this.#rowIdFromEvent(event);
        const rows = this.rows;
        const index = rows.findIndex(row => row.id === id);
        if (index < 0 || event.isComposing) {
            return true;
        }

        const row = rows[index];
        const extend = event.shiftKey && this.selectionMode === "multiple";
        const move = (target: number): void => {
            const next = rows[Math.max(0, Math.min(rows.length - 1, target))];
            event.preventDefault();
            if (!next) {
                return;
            }
            if (extend) {
                this.#anchorId ||= row.id;
                this.#selectRange(this.#anchorId, next.id);
            }
            this.#focusRow(next.id);
        };

        switch (event.key) {
            case "ArrowDown":
                move(index + 1);
                break;
            case "ArrowUp":
                move(index - 1);
                break;
            case "Home":
                move(0);
                break;
            case "End":
                move(rows.length - 1);
                break;
            case "Enter":
                event.preventDefault();
                if (!row.disabled) {
                    this.#activate(row.id);
                }
                break;
            case " ":
                event.preventDefault();
                if (!row.disabled && this.selectionMode !== "none") {
                    this.#anchorId = row.id;
                    if (this.selectionMode === "multiple") {
                        this.#toggleSelection(row.id);
                    } else {
                        this.#setSelection([row.id]);
                    }
                }
                break;
            case "Escape":
                if (this.selectedIds.length > 0 && this.selectionMode !== "none") {
                    event.preventDefault();
                    this.#setSelection([]);
                }
                break;
            case "Backspace":
                this.#navigateUp(event);
                break;
            case "ArrowLeft":
                if (event.altKey) {
                    this.#navigateUp(event);
                }
                break;
            case "a":
            case "A":
                if ((event.ctrlKey || event.metaKey) && this.selectionMode === "multiple") {
                    event.preventDefault();
                    this.#setSelection(rows.filter(candidate => !candidate.disabled).map(candidate => candidate.id));
                }
                break;
            default:
                break;
        }

        return true;
    }

    // ---- model helpers -------------------------------------------------------------------------------------------

    #findItem(id: string): VioletFileExplorerItem | undefined {
        return this.items.find(item => item.id === id);
    }

    #parentOf(item: VioletFileExplorerItem): string {
        return item.parentId ?? "";
    }

    #pathTo(folderId: string): string[] {
        const path: string[] = [];
        const seen = new Set<string>();
        let cursor = folderId;

        while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            path.unshift(cursor);
            const item = this.#findItem(cursor);
            if (!item) {
                break;
            }
            cursor = this.#parentOf(item);
        }

        return path;
    }

    #expandAncestors(folderId: string): void {
        this.#expandedIds.add("");
        for (const id of this.#pathTo(folderId).slice(0, -1)) {
            this.#expandedIds.add(id);
        }
    }

    #requestIfUnloaded(folderId: string, reason: VioletFileExplorerFolderRequestReason): void {
        if (!folderId || this.#requested.has(folderId)) {
            return;
        }

        const folder = this.#findItem(folderId);
        if (folder?.kind === "folder" && folder.loaded === false) {
            this.#requested.add(folderId);
            this.#emitFolderRequest(folderId, reason);
        }
    }

    #emitFolderRequest(folderId: string, reason: VioletFileExplorerFolderRequestReason): void {
        this.$emit("folder-request", {
            folderId: folderId || null,
            reason,
        } satisfies VioletFileExplorerFolderRequestDetail);
    }

    // ---- derived view state --------------------------------------------------------------------------------------

    #queueRebuild(): void {
        if (!this.#connected || this.#rebuildQueued) {
            return;
        }

        this.#rebuildQueued = true;
        queueMicrotask(() => {
            this.#rebuildQueued = false;
            if (this.#connected) {
                this.#rebuild();
            }
        });
    }

    #rebuild(): void {
        const folderId = this.currentFolderId ?? "";
        const hadListFocus = this.#listHasFocus();
        const previousActiveId = this.#activeRowId;
        const previousIndex = this.rows.findIndex(row => row.id === previousActiveId);

        this.#rebuildCrumbs(folderId);
        this.#rebuildTree(folderId);
        this.#rebuildRows(folderId);
        this.#updateStatus(folderId);
        this.#restoreFocus(hadListFocus, previousIndex, previousActiveId);
    }

    #rebuildCrumbs(folderId: string): void {
        const crumbs: Crumb[] = [this.#crumb("", this.rootLabel || "Files")];
        for (const id of this.#pathTo(folderId)) {
            crumbs.push(this.#crumb(id, this.#findItem(id)?.name ?? id));
        }
        this.crumbs = crumbs;
    }

    #crumb(id: string, name: string): Crumb {
        let crumb = this.#crumbCache.get(id);
        if (!crumb) {
            crumb = new Crumb(id, name);
            this.#crumbCache.set(id, crumb);
        }
        crumb.name = name;
        return crumb;
    }

    #rebuildTree(folderId: string): void {
        const folders = this.items.filter(item => item.kind === "folder");
        const childrenOf = new Map<string, VioletFileExplorerItem[]>();
        for (const folder of folders) {
            const parent = this.#parentOf(folder);
            const siblings = childrenOf.get(parent) ?? [];
            siblings.push(folder);
            childrenOf.set(parent, siblings);
        }

        const visiting = new Set<string>();
        const build = (id: string, name: string): FolderNode => {
            let node = this.#nodeCache.get(id);
            if (!node) {
                node = new FolderNode(id === "" ? ROOT_VALUE : id);
                this.#nodeCache.set(id, node);
            }

            const folder = id ? this.#findItem(id) : undefined;
            const subfolders = visiting.has(id) ? [] : (childrenOf.get(id) ?? []);
            visiting.add(id);
            node.name = name;
            node.expandable = folder?.loaded === false;
            node.expanded = this.#expandedIds.has(id);
            node.children = subfolders.map(child => build(child.id, child.name));
            visiting.delete(id);
            return node;
        };

        this.folderTree = [build("", this.rootLabel || "Files")];
        this.treeValue = folderId === "" ? ROOT_VALUE : folderId;

        // Nested items are added after the tree's own slotchange, so ask it to re-measure levels, sets and selection
        // once the new items have rendered. The tree may not exist yet on the very first rebuild.
        void Updates.next().then(() => {
            const tree = this.shadowRoot?.querySelector("violet-tree") as VioletTree | null;
            if (tree) {
                // The tree clears `value` when it has no matching item yet, so (re)assert the current folder.
                tree.value = this.treeValue;
                tree.handleSlotChange();
            }
        });
    }

    #rebuildRows(folderId: string): void {
        const selected = new Set(this.selectedIds);
        const contents = this.items.filter(item => this.#parentOf(item) === folderId);
        const rows = contents.map(item => {
            let row = this.#rowCache.get(item.id);
            if (!row) {
                row = new Row(item.id);
                this.#rowCache.set(item.id, row);
            }

            row.name = item.name;
            row.kind = item.kind;
            row.meta = item.meta ?? "";
            row.icon = item.icon || (item.kind === "folder" ? "system/folder" : "system/document");
            row.disabled = Boolean(item.disabled);
            row.selected = this.selectionMode !== "none" && selected.has(item.id);
            return row;
        });

        for (const id of [...this.#rowCache.keys()]) {
            if (!contents.some(item => item.id === id)) {
                this.#rowCache.delete(id);
            }
        }

        if (!rows.some(row => row.id === this.#activeRowId)) {
            this.#activeRowId = (rows.find(row => row.selected) ?? rows[0])?.id ?? "";
        }
        for (const row of rows) {
            row.active = row.id === this.#activeRowId;
        }

        const folder = folderId ? this.#findItem(folderId) : undefined;
        const awaitingContents = folder?.kind === "folder" && folder.loaded === false;
        this.isLoading = (this.busy || awaitingContents) && !this.loadError;
        this.isEmpty = rows.length === 0 && !this.isLoading && !this.loadError;
        this.listLabel = `Contents of ${folder?.name ?? (this.rootLabel || "Files")}`;
        this.rows = rows;
    }

    #updateStatus(folderId: string): void {
        const name = folderId ? (this.#findItem(folderId)?.name ?? folderId) : this.rootLabel || "Files";
        let message: string;

        if (this.loadError) {
            message = `${name}: ${this.loadError}`;
        } else if (this.isLoading) {
            message = `Loading ${name}`;
        } else if (this.isEmpty) {
            message = `${name} is empty`;
        } else {
            const count = this.rows.length;
            message = `${name}: ${count} ${count === 1 ? "item" : "items"}`;
        }

        if (message !== this.#lastAnnouncement) {
            this.#lastAnnouncement = message;
            this.statusMessage = message;
        }
    }

    // ---- selection and activation --------------------------------------------------------------------------------

    #setSelection(ids: string[]): void {
        const next = this.selectionMode === "single" ? ids.slice(-1) : ids;
        const current = this.selectedIds;
        if (next.length === current.length && next.every((id, index) => id === current[index])) {
            return;
        }

        this.selectedIds = next;
        this.$emit("selection-change", {
            selectedIds: next,
            items: next.map(id => this.#findItem(id)).filter((item): item is VioletFileExplorerItem => Boolean(item)),
        } satisfies VioletFileExplorerSelectionChangeDetail);
    }

    #toggleSelection(id: string): void {
        const current = this.selectedIds;
        this.#anchorId = id;
        this.#setSelection(current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    }

    #selectRange(fromId: string, toId: string): void {
        const rows = this.rows;
        const from = rows.findIndex(row => row.id === fromId);
        const to = rows.findIndex(row => row.id === toId);
        if (from < 0 || to < 0) {
            return;
        }

        const [start, end] = from <= to ? [from, to] : [to, from];
        this.#setSelection(
            rows
                .slice(start, end + 1)
                .filter(row => !row.disabled)
                .map(row => row.id),
        );
    }

    #activate(id: string): void {
        const item = this.#findItem(id);
        if (!item || item.disabled) {
            return;
        }

        const notCanceled = this.$emit("item-activate", {
            id: item.id,
            kind: item.kind,
            item,
        } satisfies VioletFileExplorerItemActivateDetail);

        if (notCanceled !== false && item.kind === "folder") {
            this.#navigate(item.id, { kind: "first" });
        }
    }

    // ---- navigation ----------------------------------------------------------------------------------------------

    #navigate(folderId: string, focus: { kind: "first" } | { kind: "id"; id: string } | null): void {
        if (folderId === this.currentFolderId) {
            if (focus) {
                this.#pendingFocus = focus;
                this.#queueRebuild();
            }
            return;
        }

        if (this.selectedIds.length > 0) {
            this.#setSelection([]);
        }

        this.#pendingFocus = focus;
        this.#anchorId = "";
        this.#activeRowId = "";
        this.currentFolderId = folderId;
        this.$emit("folder-change", {
            folderId: folderId || null,
            path: this.#pathTo(folderId),
        } satisfies VioletFileExplorerFolderChangeDetail);
    }

    #navigateUp(event: KeyboardEvent): void {
        const folderId = this.currentFolderId;
        if (!folderId) {
            return;
        }

        event.preventDefault();
        const folder = this.#findItem(folderId);
        this.#navigate(folder ? this.#parentOf(folder) : "", { kind: "id", id: folderId });
    }

    // ---- focus ---------------------------------------------------------------------------------------------------

    #listbox(): HTMLElement | null {
        return (this.shadowRoot?.querySelector(".list") as HTMLElement | null) ?? null;
    }

    #rowElement(id: string): HTMLElement | null {
        const list = this.#listbox();
        if (!list) {
            return null;
        }

        return (Array.from(list.querySelectorAll<HTMLElement>("[data-item-id]")).find(
            element => element.dataset.itemId === id,
        ) ?? null);
    }

    #rowIdFromEvent(event: Event): string {
        for (const target of event.composedPath()) {
            if (target instanceof HTMLElement && target.dataset.itemId !== undefined) {
                return target.dataset.itemId;
            }
        }
        return "";
    }

    #listHasFocus(): boolean {
        const list = this.#listbox();
        const active = this.shadowRoot?.activeElement ?? null;
        return Boolean(list && active && list.contains(active));
    }

    #setActiveRow(id: string): void {
        this.#activeRowId = id;
        for (const row of this.rows) {
            row.active = row.id === id;
        }
    }

    #focusRow(id: string): void {
        this.#setActiveRow(id);
        this.#rowElement(id)?.focus();
    }

    #focusActiveRow(): void {
        void Updates.next().then(() => {
            const element = this.#rowElement(this.#activeRowId);
            if (element) {
                element.focus();
                return;
            }
            (this.shadowRoot?.querySelector(".content") as HTMLElement | null)?.focus();
        });
    }

    #restoreFocus(hadListFocus: boolean, previousIndex: number, previousActiveId: string): void {
        const pending = this.#pendingFocus;
        if (!this.isLoading) {
            this.#pendingFocus = null;
        }

        if (pending) {
            // Navigation was requested from the list or breadcrumb: land on a predictable row.
            const rows = this.rows;
            const target = pending.kind === "id" ? (rows.find(row => row.id === pending.id) ?? rows[0]) : rows[0];
            if (target) {
                this.#setActiveRow(target.id);
            }
            if (this.isLoading) {
                // Park focus on the content region; the pending target is applied once the contents arrive.
                void Updates.next().then(() => (this.shadowRoot?.querySelector(".content") as HTMLElement | null)?.focus());
            } else {
                this.#focusActiveRow();
            }
            return;
        }

        if (hadListFocus && !this.rows.some(row => row.id === previousActiveId)) {
            // The focused row disappeared (contents changed): keep focus in the listing, near where it was.
            const fallback = this.rows[Math.min(Math.max(previousIndex, 0), this.rows.length - 1)];
            if (fallback) {
                this.#setActiveRow(fallback.id);
            }
            this.#focusActiveRow();
            return;
        }

        if (hadListFocus) {
            this.#focusActiveRow();
        }
    }
}

attr({ attribute: "current-folder-id" })(VioletFileExplorer.prototype, "currentFolderId");
attr({ attribute: "root-label" })(VioletFileExplorer.prototype, "rootLabel");
attr({ attribute: "selection-mode" })(VioletFileExplorer.prototype, "selectionMode");
attr({ mode: "boolean" })(VioletFileExplorer.prototype, "busy");
attr({ attribute: "load-error" })(VioletFileExplorer.prototype, "loadError");
attr(VioletFileExplorer.prototype, "label");

if (!customElements.get("violet-file-explorer")) {
    await FASTElement.define(VioletFileExplorer, {
        name: "violet-file-explorer",
        template,
        styles,
    });
}

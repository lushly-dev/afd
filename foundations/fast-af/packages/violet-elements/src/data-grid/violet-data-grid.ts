import {
    attr,
  type ContentTemplate,
  FASTElement,
    html,
    observable,
    render,
    repeat,
    Updates,
    when,
} from "@lushly-dev/fast-element";
import {
    elementScroll,
    observeElementOffset,
    observeElementRect,
    type VirtualItem,
  Virtualizer,
} from "@tanstack/virtual-core";

import "../checkbox/violet-checkbox";
import "../icon/violet-icon";
import "../radio/violet-radio";
import "../text-field/violet-text-field";
import { registerSystemSortAscendingIcon } from "../icon/generated/icons/system-sort-ascending";
import { registerSystemSortDescendingIcon } from "../icon/generated/icons/system-sort-descending";
import { logicalArrowKey } from "../foundations/violet-direction";
import { styles } from "./violet-data-grid.styles";
import {
  resolveCellPartText as composeCellPartText,
    isCellSelected as computeIsCellSelected,
    isFillPreviewCell as computeIsFillPreviewCell,
    rangeEdgeForCell as computeRangeEdgeForCell,
} from "./violet-data-grid-cell-state";
import {
    defaultCellContentTemplate,
    inputCellEditorTemplate,
    selectCellEditorTemplate,
} from "./violet-data-grid-cell-templates";
import {
  copyTextForSelection,
  normalizePastedText as normalizeGridPastedText,
  resolvePasteOriginLocation,
  sampleAutosizeRows,
} from "./violet-data-grid-clipboard";
import {
    cellValueFor as resolveCellValue,
    editorOptionsForColumn as resolveEditorOptionsForColumn,
    serializeCellValue as serializeGridCellValue,
    sortRows as sortGridRows,
  stringifyCellValue,
} from "./violet-data-grid-data";
import {
    beginEditingState,
    cancelEditingState as clearEditingState,
    editorStringValue,
    focusEditorAtEnd,
    seedEditorValue,
} from "./violet-data-grid-editing";
import {
    cellElementFromEvent,
    cellElementFromTarget as eventCellElementFromTarget,
    closestFromEventPath as eventClosestFromEventPath,
} from "./violet-data-grid-events";
import {
  buildFillChanges,
  buildPasteChanges,
  clampFillBoundsToEditableTargets as clampEditableFillBounds,
  hasEditableCellsInBounds,
} from "./violet-data-grid-fill";
import {
    locationFromCellElement as geometryLocationFromCellElement,
    nearestLocationForPoint as nearestGeometryLocationForPoint,
    preferredAxisForPoint,
    rectFromCellPair,
} from "./violet-data-grid-geometry";
import {
  createCellSelection as createNavigationCellSelection,
  firstCellLocation as resolveNavigationFirstCellLocation,
  nextCellLocationForKey as resolveNextCellLocationForKey,
} from "./violet-data-grid-navigation";
import {
    clearedFillSession,
    clearedPointerSelectionSession,
    isFillPointerEventForSession,
    isPointerSelectionEventForSession,
    markPointerSelectionMoved,
    pointerSelectionSuppressesNextClick,
  beginFillDrag as startFillDragSession,
  beginPointerSelection as startPointerSelectionSession,
    type VioletDataGridFillSession,
    type VioletDataGridPointerSelectionSession,
} from "./violet-data-grid-pointer";
import {
  createPresentedColumn as buildPresentedColumn,
  createPresentedRow as buildPresentedRow,
  syncEditingState,
  syncActiveCell as syncPresentedActiveCell,
  syncCellSelection as syncPresentedCellSelection,
  syncFillPreview as syncPresentedFillPreview,
} from "./violet-data-grid-presentation";
import {
    clearedColumnResizeSession,
    columnResizeKeyShortcut,
    isColumnResizeShortcut,
    keyboardResizedColumnWidth as computeKeyboardResizedColumnWidth,
    resizedColumnWidth as computeResizedColumnWidth,
  isColumnResizeEventForSession,
  beginColumnResize as startColumnResizeSession,
    type VioletDataGridResizeSession,
} from "./violet-data-grid-resize";
import {
  nextTabLocation,
  selectedLocations,
  locationForIndices as selectionLocationForIndices,
  rangeFromBounds as selectionRangeFromBounds,
} from "./violet-data-grid-selection";
import {
  autosizedColumnWidth as computeAutosizedColumnWidth,
  minimumColumnWidth as computeMinimumColumnWidth,
  renderedColumnWidth as computeRenderedColumnWidth,
  resolvedColumnWidth as resolveGridColumnWidth,
} from "./violet-data-grid-sizing";
import {
    isEditorElement as isGridEditorElement,
    isFillHandleTarget as isGridFillHandleTarget,
    isInteractiveCellWidgetTarget as isGridInteractiveCellWidgetTarget,
} from "./violet-data-grid-targets";
import {
  opensOnSingleActiveClick as editorOpensOnSingleActiveClick,
  editStringForRawValue,
  booleanCellValue as normalizeBooleanCellValue,
  normalizedEditingValue as normalizeEditingValue,
  resolveEditingValue,
} from "./violet-data-grid-values";
import {
  buildVirtualizerUpdateOptions,
  buildRenderedRows as computeRenderedRows,
} from "./violet-data-grid-virtualization";

registerSystemSortAscendingIcon();
registerSystemSortDescendingIcon();

export type VioletDataGridAlignment = "start" | "center" | "end";
export type VioletDataGridSelectionMode = "none" | "single" | "multiple";
export type VioletDataGridDensity = "compact" | "natural" | "comfortable";
export type VioletDataGridSortDirection = "ascending" | "descending";
export type VioletDataGridSortMode = "local" | "external";
export type VioletDataGridFocusMode = "row" | "cell";
export type VioletDataGridEditor = "text" | "number" | "checkbox" | "select" | "custom";

export interface VioletDataGridEditorOption {
    label: string;
    value: string;
    description?: string;
    src?: string;
    initials?: string;
    tone?: "green" | "teal" | "olive" | "gold" | "blue" | "gray";
    background?: string;
    foreground?: string;
    borderColor?: string;
    keywords?: string[];
}

export interface VioletDataGridCellTemplateContext<RowData = unknown> {
    rowId: string;
    rowLabel: string;
    columnId: string;
    columnLabel: string;
    rowData: RowData;
    rawValue: unknown;
    text: string;
    active: boolean;
    selected: boolean;
    editable: boolean;
    editing: boolean;
    fillPreview: boolean;
    editValue?: string;
  editingError?: string;
  editingErrorId?: string;
    editorOptions?: VioletDataGridEditorOption[];
}

export type VioletDataGridCellTemplate<_RowData = unknown> = ContentTemplate;
export type VioletDataGridCellEditorTemplate<_RowData = unknown> = ContentTemplate;

export interface VioletDataGridColumn<RowData = unknown> {
    id: string;
    label: string;
    sortable?: boolean;
    filterable?: boolean;
    editable?: boolean;
    editor?: VioletDataGridEditor;
    width?: string;
    align?: VioletDataGridAlignment;
    cellPart?: string;
    headerPart?: string;
    value?: (row: RowData) => unknown;
    render?: (row: RowData) => unknown;
    cellTemplate?: VioletDataGridCellTemplate<RowData>;
    editorTemplate?: VioletDataGridCellEditorTemplate<RowData>;
  editorOptions?: VioletDataGridEditorOption[] | ((row: RowData) => VioletDataGridEditorOption[]);
    serialize?: (value: unknown, row: RowData) => string;
    parse?: (value: unknown, row: RowData) => unknown;
}

export interface VioletDataGridRow<RowData = unknown> {
    id: string;
    /** Human-readable row identity used in interactive control names. */
    label?: string;
    data: RowData;
}

export interface VioletDataGridSort {
    columnId: string;
    direction: VioletDataGridSortDirection;
}

export interface VioletDataGridFilterState {
    query?: string;
}

export interface VioletDataGridCellLocation {
    rowId: string;
    columnId: string;
}

export interface VioletDataGridCellRange {
    anchor: VioletDataGridCellLocation;
    focus: VioletDataGridCellLocation;
}

export interface VioletDataGridChangeDetail {
    rowId: string;
    columnId: string;
    value: unknown;
}

export interface VioletDataGridCopyDetail {
    cells: VioletDataGridCellLocation[];
    text: string;
}

export interface VioletDataGridPasteDetail {
    origin: VioletDataGridCellLocation;
    text: string;
    changes: VioletDataGridChangeDetail[];
}

export interface VioletDataGridFillDetail {
    source: VioletDataGridCellRange;
    target: VioletDataGridCellRange;
    changes: VioletDataGridChangeDetail[];
}

/** Direction for {@link VioletDataGrid.fillSelection}. */
export type VioletDataGridFillDirection = "up" | "down" | "left" | "right";

export interface VioletDataGridColumnWidthDetail {
    columnId: string;
    width: string;
}

interface VioletPresentedColumn<RowData = unknown> {
    id: string;
    label: string;
    sortable: boolean;
    width?: string;
    widthStyle: string;
    align: VioletDataGridAlignment;
    headerPart?: string;
    headerPartText: string;
    cellPart?: string;
    cellPartText: string;
    source: VioletDataGridColumn<RowData>;
}

interface VioletPresentedCell {
    rowId: string;
    rowLabel: string;
    columnId: string;
    columnLabel: string;
    rowData: unknown;
    align: VioletDataGridAlignment;
    rawValue: unknown;
    text: string;
    widthStyle: string;
    cellId: string;
    active: boolean;
    selected: boolean;
    rangeEdge: string;
    editable: boolean;
    editor: VioletDataGridEditor;
    editing: boolean;
    editValue: string;
  editingError: string;
  editingErrorId: string;
    fillPreview: boolean;
    cellPart?: string;
    cellPartText: string;
    resolvedCellPartText: string;
    cellTemplate?: VioletDataGridCellTemplate<unknown>;
    editorTemplate?: VioletDataGridCellEditorTemplate<unknown>;
    editorOptions: VioletDataGridEditorOption[];
    parse?: (value: unknown, row: unknown) => unknown;
}

interface VioletPresentedRow<RowData = unknown> {
    id: string;
    label: string;
    data: RowData;
    cells: VioletPresentedCell[];
}

interface VioletRenderedRow {
    item: VirtualItem;
    row: VioletPresentedRow;
}

interface VioletFocusedSelectionControl {
  element: HTMLElement;
  focusGeneration: number;
  rowId: string;
  selector: "violet-radio.selection-radio" | "violet-checkbox.selection-checkbox";
}

interface VioletDataGridBounds {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

interface VioletInteractionSnapshot {
  selectionBounds: VioletDataGridBounds | null;
  fillPreviewBounds: VioletDataGridBounds | null;
  fillSourceBounds: VioletDataGridBounds | null;
}

interface VioletDataGridEditingSession {
  id: number;
  location: VioletDataGridCellLocation;
}

type VioletTextFieldLike = EventTarget & {
    value?: string;
};

type VioletCheckboxLike = EventTarget & {
    checked?: boolean;
    indeterminate?: boolean;
};

type VioletCellEditorLike = HTMLElement & {
    value?: string;
  focus?: (options?: FocusOptions) => void;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  selectionDirection?: "forward" | "backward" | "none" | null;
  setSelectionRange?: (
    start: number,
    end: number,
    direction?: "forward" | "backward" | "none",
  ) => void;
};

const bodyRowTemplate = html<VioletRenderedRow, VioletDataGrid>`
    <tr
        part="row"
        data-index="${(x) => String(x.item.index)}"
        data-selected="${(x, c) => String(c.parent.isRowSelected(x.row.id))}"
        data-row-index="${(x) => String(x.item.index)}"
        aria-rowindex="${(x) => String(x.item.index + 2)}"
        aria-selected="${(x, c) =>
          c.parent.selectionMode === "none" ? null : String(c.parent.isRowSelected(x.row.id))}"
    >
        <td
            class="selection-cell"
            part="cell"
            headers="${(_x, c) => c.parent.selectionHeaderId}"
            ?hidden="${(x, c) => c.parent.selectionMode === "none"}"
        >
            ${when(
                (x, c) => c.parent.selectionMode === "single",
                html<VioletRenderedRow, VioletDataGrid>`
                    <violet-radio
                        class="selection-radio"
                        inline
                        value="${(x) => x.row.id}"
                        name="${(x, c) => c.parent.selectionControlName}"
                        aria-label="${(x, c) => c.parent.selectionLabelFor(x.row.id, x.row.label)}"
                        :checked="${(x, c) => c.parent.isRowSelected(x.row.id)}"
                        @pointerdown="${(x, c) => c.parent.handleSelectionControlPointerDown(c.event as PointerEvent)}"
                        @click="${(x, c) => c.parent.handleSelectionControlClick(c.event)}"
                        @change="${(x, c) => c.parent.handleRowSelection(x.row.id, c.event)}"
                    ></violet-radio>
                `,
            )}
            ${when(
                (x, c) => c.parent.selectionMode === "multiple",
                html<VioletRenderedRow, VioletDataGrid>`
                    <violet-checkbox
                        class="selection-checkbox"
                        inline
                        aria-label="${(x, c) => c.parent.selectionLabelFor(x.row.id, x.row.label)}"
                        :checked="${(x, c) => c.parent.isRowSelected(x.row.id)}"
                        @pointerdown="${(x, c) => c.parent.handleSelectionControlPointerDown(c.event as PointerEvent)}"
                        @click="${(x, c) => c.parent.handleRowCheckboxClick(x.row.id, c.event)}"
                    ></violet-checkbox>
                `,
            )}
        </td>
        ${repeat(
          (x) => x.row.cells,
            html<VioletPresentedCell>`
                <td
                    id="${(x) => x.cellId}"
                    headers="${(x, c) => (c.parentContext.parent as VioletDataGrid).columnHeaderIdFor(x.columnId)}"
                    part="${(x) => x.resolvedCellPartText}"
                    data-align="${(x) => x.align}"
                    data-row-id="${(x) => x.rowId}"
                    data-column-id="${(x) => x.columnId}"
                    data-active="${(x) => String(x.active)}"
                    data-selected="${(x) => String(x.selected)}"
                    data-fill-preview="${(x) => String(x.fillPreview)}"
                    data-editing="${(x) => String(x.editing)}"
                    data-range-edge="${(x) => x.rangeEdge}"
                    style="${(x) => x.widthStyle}"
                >
                    ${when(
                      (x) => x.editing && (x.editor === "text" || x.editor === "number"),
                        html<VioletPresentedCell>`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${render(
                                  (x) => x,
                                  (x) => x.cellTemplate ?? defaultCellContentTemplate,
                                )}
                            </span>
                            ${inputCellEditorTemplate}
                        `,
                    )}
                    ${when(
                      (x) => x.editing && x.editor === "select",
                        html<VioletPresentedCell>`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${render(
                                  (x) => x,
                                  (x) => x.cellTemplate ?? defaultCellContentTemplate,
                                )}
                            </span>
                            ${selectCellEditorTemplate}
                        `,
                    )}
                    ${when(
                      (x) => x.editing && x.editor === "custom",
                        html<VioletPresentedCell>`
                            <span class="cell-sizing-content" aria-hidden="true">
                                ${render(
                                  (x) => x,
                                  (x) => x.cellTemplate ?? defaultCellContentTemplate,
                                )}
                            </span>
                            ${render(
                              (x) => x,
                              (x) => x.editorTemplate ?? defaultCellContentTemplate,
                            )}
                        `,
                    )}
                    ${when(
                      (x) => !x.editing && x.editor === "checkbox",
                        html<VioletPresentedCell, VioletDataGrid>`
                            <span class="cell-widget" data-align="${(x) => x.align}">
                                <violet-checkbox
                                    class="cell-checkbox"
                                    data-cell-widget="checkbox"
                                    inline
                                    aria-label="${(x) => `${x.columnLabel} for ${x.rowLabel}`}"
                                    :checked="${(x) => normalizeBooleanCellValue(x.rawValue)}"
                                    ?disabled="${(x) => !x.editable}"
                                    @click="${(x, c) =>
                                      (
                                        c.parentContext.parent as VioletDataGrid
                                      ).handleCellCheckboxClick(x.rowId, x.columnId, c.event)}"
                                ></violet-checkbox>
                            </span>
                        `,
                    )}
                    ${when(
                      (x) => x.editing && Boolean(x.editingError),
                      html<VioletPresentedCell>`
                          <span
                              class="cell-editor-error"
                              id="${(x) => x.editingErrorId}"
                              role="alert"
                          >${(x) => x.editingError}</span>
                      `,
                    )}
                    ${when(
                      (x) => !x.editing && x.editor !== "checkbox",
                        html<VioletPresentedCell>`
                            ${render(
                              (x) => x,
                              (x) => x.cellTemplate ?? defaultCellContentTemplate,
                            )}
                        `,
                    )}
                    ${when(
                        (x, c) =>
                            (c.parentContext.parent as VioletDataGrid).shouldShowFillHandleForCell(
                                x.rowId,
                          x.columnId,
                            ),
                        html<VioletPresentedCell>`
                            <span class="fill-handle" data-fill-handle="true" aria-hidden="true"></span>
                        `,
                    )}
                </td>
            `,
        )}
    </tr>
`;

const fullTableTemplate = html<VioletDataGrid>`
    <div class="table-canvas" style="--_virtual-total-size:${(x) => `${x.virtualTotalSize}px`};">
        <table
            class="table-full-table"
            part="table"
            aria-rowcount="${(x) => String(x.logicalRowCount)}"
            aria-colcount="${(x) => String(x.logicalColumnCount)}"
                >
        <colgroup>
            <col
                class="selection-column"
                style="${(x) =>
                  x.selectionMode === "none"
                    ? "width:0;inline-size:0;min-inline-size:0;max-inline-size:0;"
                    : "width:var(--_selection-column-size);inline-size:var(--_selection-column-size);min-inline-size:var(--_selection-column-size);max-inline-size:var(--_selection-column-size);"}"
            />
                ${repeat(
              (x) => x.presentedColumns,
                                html<VioletPresentedColumn>`
                    <col data-column-id="${(x) => x.id}" style="${(x) => x.widthStyle}" />
                `,
                            )}
        </colgroup>
        <thead part="head">
            <tr part="header-row">
                <th
                    id="${(x) => x.selectionHeaderId}"
                    class="selection-header"
                    part="header-cell selection-header-cell"
                    scope="col"
                    aria-label="${(x) => x.selectionHeaderLabel}"
                    ?hidden="${(x) => x.selectionMode === "none"}"
                >
                    <span class="visually-hidden">${(x) => x.selectionHeaderLabel}</span>
                    ${when(
                      (x) => x.selectionMode === "multiple" && x.presentedRows.length > 0,
                        html<VioletDataGrid>`
                            <violet-checkbox
                                class="selection-checkbox"
                                inline
                                aria-label="Select all rows"
                                :checked="${(x) => x.allRowsSelected}"
                                :indeterminate="${(x) => x.partiallySelected}"
                                @pointerdown="${(x, c) => x.handleSelectionControlPointerDown(c.event as PointerEvent)}"
                                @click="${(x, c) => x.handleToggleAllCheckboxClick(c.event)}"
                            ></violet-checkbox>
                        `,
                    )}
                </th>
                ${repeat(
                  (x) => x.presentedColumns,
                    html<VioletPresentedColumn, VioletDataGrid>`
                        <th
                            id="${(x, c) => c.parent.columnHeaderIdFor(x.id)}"
                            part="${(x) => x.headerPartText}"
                            scope="col"
                            data-column-id="${(x) => x.id}"
                            data-align="${(x) => x.align}"
                            aria-sort="${(x, c) => c.parent.sortStateFor(x.id)}"
                            style="${(x) => x.widthStyle}"
                            tabindex="${(x, c) => (x.sortable ? null : c.parent.columnHeaderTabIndexFor(x.id))}"
                            aria-keyshortcuts="${(x) => (x.sortable ? null : columnResizeKeyShortcut)}"
                            @keydown="${(x, c) => c.parent.handleColumnHeaderKeydown(x.id, c.event as KeyboardEvent)}"
                            @focusin="${(x, c) => c.parent.handleColumnHeaderFocus(x.id, c.event as FocusEvent)}"
                        >
                            ${when(
                              (x) => x.sortable,
                                html<VioletPresentedColumn, VioletDataGrid>`
                                    <button
                                        class="header-button"
                                        type="button"
                                        tabindex="${(x, c) => c.parent.columnHeaderTabIndexFor(x.id)}"
                                        aria-keyshortcuts="${() => columnResizeKeyShortcut}"
                                        @click="${(x, c) => c.parent.handleSortRequest(x.id)}"
                                    >
                                        <span class="header-label">${(x) => x.label}</span>
                                        <violet-icon
                                            class="sort-indicator"
                                            data-sorted="${(x, c) => String(c.parent.isSortedColumn(x.id))}"
                                            icon="${(x, c) => c.parent.sortIconNameFor(x.id)}"
                                            decorative
                                        ></violet-icon>
                                    </button>
                                `,
                            )}
                            ${when(
                              (x) => !x.sortable,
                                html<VioletPresentedColumn>`
                                    <span class="header-label">${(x) => x.label}</span>
                                `,
                            )}
                            <button
                                class="column-resizer"
                                type="button"
                                tabindex="-1"
                                aria-label="${(x) => `Resize ${x.label} column`}"
                                data-column-resizer="${(x) => x.id}"
                                @pointerdown="${(x, c) => c.parent.handleColumnResizePointerDown(x.id, c.event as PointerEvent)}"
                                @pointermove="${(x, c) => c.parent.handleColumnResizePointerMove(c.event as PointerEvent)}"
                                @pointerup="${(x, c) => c.parent.handleColumnResizePointerUp(c.event as PointerEvent)}"
                                @pointercancel="${(x, c) => c.parent.handleColumnResizePointerCancel(c.event as PointerEvent)}"
                                @dblclick="${(x, c) => c.parent.handleColumnResizeDoubleClick(x.id, c.event as MouseEvent)}"
                                @keydown="${(x, c) => c.parent.handleColumnResizeKeyDown(x.id, c.event as KeyboardEvent)}"
                            ></button>
                        </th>
                    `,
                )}
            </tr>
        </thead>
        <tbody part="body">
            <tr
                class="virtual-spacer-row"
                aria-hidden="true"
                ?hidden="${(x) => !x.virtualize || x.virtualPaddingStart <= 0}"
            >
                <td
                    colspan="${(x) => String(x.columnSpan)}"
                    style="block-size:${(x) => `${x.virtualPaddingStart}px`};"
                ></td>
            </tr>
            ${repeat((x) => x.renderedRows, bodyRowTemplate)}
            <tr
                class="virtual-spacer-row"
                aria-hidden="true"
                ?hidden="${(x) => !x.virtualize || x.virtualPaddingEnd <= 0}"
            >
                <td
                    colspan="${(x) => String(x.columnSpan)}"
                    style="block-size:${(x) => `${x.virtualPaddingEnd}px`};"
                ></td>
            </tr>
        </tbody>
    </table>
    </div>
`;

const template = html<VioletDataGrid>`
    <div class="grid-shell">
        ${when(
          (x) => x.shouldShowToolbar,
            html<VioletDataGrid>`
                <div class="toolbar" part="toolbar">
                    ${when(
                      (x) => x.showsBuiltInFilter,
                        html<VioletDataGrid>`
                            <div class="filter-shell">
                                <violet-text-field
                                    class="filter-field"
                                    aria-label="Filter rows"
                                    type="search"
                                    :value="${(x) => x.filterState.query ?? ""}"
                                    placeholder="Filter visible rows"
                                    @input="${(x, c) => x.handleFilterInput(c.event)}"
                                ></violet-text-field>
                            </div>
                        `,
                        )}
                    <div class="toolbar-meta">
                        <span>${(x) => x.rowSummary}</span>
                        <div class="toolbar-slot">
                            <slot
                                name="toolbar"
                                @slotchange="${(x, c) => x.handleToolbarSlotChange(c.event)}"
                            ></slot>
                        </div>
                    </div>
                </div>
            `,
        )}

        <slot class="default-slot"></slot>

        <div class="table-region">
            <div
                class="edit-status"
                part="edit-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >${(x) => x.editAnnouncement}</div>
            ${when(
              (x) => x.presentedRows.length > 0,
                html<VioletDataGrid>`
                            <div
                                class="table-scroll"
                                role="${(x) => (x.getAttribute("aria-label") ? "group" : null)}"
                                aria-label="${(x) => x.getAttribute("aria-label")}"
                                tabindex="${(x) => (x.focusMode === "cell" ? "0" : "-1")}"
                                aria-describedby="${(x) => (x.focusMode === "cell" ? x.activeCellLabelId : null)}"
                                aria-keyshortcuts="${(x) => (x.focusMode === "cell" ? columnResizeKeyShortcut : null)}"
                                @focus="${(x) => x.handleGridFocus()}"
                                @click="${(x, c) => x.handleGridClick(c.event)}"
                                @dblclick="${(x, c) => x.handleGridDoubleClick(c.event as MouseEvent)}"
                                @pointerdown="${(x, c) => x.handleGridPointerDown(c.event as PointerEvent)}"
                                @pointermove="${(x, c) => x.handleGridPointerMove(c.event as PointerEvent)}"
                                @pointerup="${(x, c) => x.handleGridPointerUp(c.event as PointerEvent)}"
                                @pointercancel="${(x, c) => x.handleGridPointerCancel(c.event as PointerEvent)}"
                                @focusout="${(x, c) => x.handleGridFocusOut(c.event)}"
                                @input="${(x, c) => x.handleGridInput(c.event)}"
                                @change="${(x, c) => x.handleGridChange(c.event)}"
                                @copy="${(x, c) => x.handleGridCopy(c.event as ClipboardEvent)}"
                                @paste="${(x, c) => x.handleGridPaste(c.event as ClipboardEvent)}"
                                @keydown="${(x, c) => x.handleGridKeydown(c.event as KeyboardEvent)}"
                            >
                                ${when(
                                  (x) => x.focusMode === "cell",
                                    html<VioletDataGrid>`
                                        <span class="visually-hidden" id="${(x) => x.activeCellLabelId}">
                                            ${(x) => x.activeCellDescription}
                                        </span>
                                    `,
                                )}
                                ${fullTableTemplate}
                            </div>
                `,
            )}

            ${when(
              (x) => x.presentedRows.length === 0 && !x.busy,
                html<VioletDataGrid>`
                    <div class="empty-state" part="empty-state">
                        <slot name="empty">No rows available.</slot>
                    </div>
                `,
            )}

            ${when(
              (x) => x.busy,
                html<VioletDataGrid>`
                    <div class="loading-overlay" part="loading-state">
                        <slot name="loading">Loading rows...</slot>
                    </div>
                `,
            )}
        </div>
    </div>
`;

/**
 * Violet reusable data grid component.
 *
 * @summary Semantic table-first data grid for FAST-AF and Violet.
 * @fires sort-change - Emitted when the user changes sort intent.
 * @fires selection-change - Emitted when row selection changes.
 * @fires filter-change - Emitted when the built-in filter input changes.
 * @fires active-cell-change - Emitted when the active cell changes in cell focus mode.
 * @fires cell-selection-change - Emitted when the rectangular cell selection changes.
 * @fires cell-copy - Emitted when an active cell or current range is copied as tab-separated text (cells containing tabs, newlines or quotes are quoted).
 * @fires cell-copy-error - Emitted when writing to the clipboard fails or the async clipboard API is unavailable; detail includes the copy payload and `error`.
 * @fires cell-paste - Emitted when pasted text is mapped onto editable cells.
 * @fires cell-fill - Emitted when an autofill drag, or `fillSelection()`, maps source cells onto a larger target range.
 * @fires column-width-change - Emitted when a column width is resized or autosized.
 * @fires edit-start - Emitted when a cell enters edit mode.
 * @fires edit-cancel - Emitted when a cell edit is cancelled.
 * @fires cell-change - Emitted when a cell edit is committed.
 * @remarks The column headers are part of the grid's keyboard model, so the grid adds one Tab stop, not
 * one per column. In cell focus mode the grid is that Tab stop: ArrowUp from the first row moves focus to
 * the active column's header, ArrowLeft/ArrowRight/Home/End move between headers, ArrowDown returns to the
 * first row, and Shift+Tab returns to the active cell. In row focus mode the headers share a roving Tab
 * stop (the last focused header, first by default) with the same arrow keys. Enter or Space on a sortable
 * header sorts it. Column resizers are not Tab stops: Ctrl+Alt+R on any column header, or on the active
 * cell in cell focus mode, moves focus to that column's resizer. ArrowLeft/ArrowRight resize it (Shift for
 * larger steps), Enter autosizes it and Escape returns focus to where it came from.
 * Virtualized mode uses TanStack Virtual core. The density-aware estimate bootstraps layout,
 * then rendered rows are measured so theme target sizes and expanded cell controls remain aligned.
 * @slot - Optional default slot rendered above the table region.
 * @slot toolbar - Optional toolbar content rendered alongside grid metadata.
 * @slot empty - Content rendered when no rows are available.
 * @slot loading - Content rendered while the grid is busy.
 * @csspart toolbar - Toolbar wrapper for filter and toolbar actions.
 * @csspart table - Root semantic table element.
 * @csspart head - Table head region.
 * @csspart body - Table body region.
 * @csspart header-row - Header row wrapper.
 * @csspart header-cell - Header cell surface.
 * @csspart selection-header-cell - The selection column's header cell (also a header-cell part).
 * @csspart row - Body row wrapper.
 * @csspart cell - Body cell surface.
 * @csspart active-cell - Active cell state hook.
 * @csspart fill-preview-cell - Autofill preview cell hook.
 * @csspart selected-cell - Selected range cell state hook.
 * @csspart selected-range-edge - Selected range boundary hook.
 * @csspart edit-status - Visible live status for edit lifecycle feedback.
 * @csspart empty-state - Empty-state container.
 * @csspart loading-state - Busy/loading overlay container.
 * @cssproperty --violet-data-grid-default-column-width - Width used when a column has no explicit width.
 * @cssproperty --violet-data-grid-virtualized-max-block-size - Optional maximum virtual viewport height;
 * set to `none` when the grid should fill a definite-height parent.
 */
export class VioletDataGrid extends FASTElement {
    #internals: ElementInternals;

    /**
     * Selection behavior for the grid.
     * Uses reflected primitive attribute state for HTML configuration.
     */
  public declare selectionMode: VioletDataGridSelectionMode;

    /**
     * Optional verb phrase naming what a single-selection radio does, such as "Open". The radio's
     * accessible name becomes "<selection-label> <row label>" ("Open First bed") instead of
     * "Select row <row label>". Ignored outside `selection-mode="single"`.
     */
  public declare selectionLabel: string | null;

    /**
     * Enables sticky table headers.
     */
  public declare stickyHeader: boolean;

    /**
     * Marks the grid as busy and shows the loading overlay.
     */
  public declare busy: boolean;

    /**
   * Enables windowed row rendering for large data sets.
     */
  public declare virtualize: boolean;

    /**
     * Density variant for the grid row spacing.
     */
  public declare density: VioletDataGridDensity;

    /**
     * Keyboard navigation mode for the grid surface.
     */
  public declare focusMode: VioletDataGridFocusMode;

    /**
     * Sorting behavior for the grid.
     * Local mode reorders rows in the component, external mode only reflects sort state and emits intent.
     */
  public declare sortMode: VioletDataGridSortMode;

    /**
     * Column definitions for the grid.
     */
  public declare columns: VioletDataGridColumn[];

    /**
     * Optional persisted width overrides keyed by column identifier.
     */
  public declare columnWidths: Record<string, string>;

    /**
     * Row data for the grid.
     */
  public declare rows: VioletDataGridRow[];

    /**
     * Enables the built-in filter field in the toolbar.
     */
  public declare showFilter: boolean;

    /**
     * Current sort descriptor.
     */
  public declare sort: VioletDataGridSort | null;

    /**
     * Optional built-in filter state.
     */
  public declare filterState: VioletDataGridFilterState;

    /**
     * Controlled or uncontrolled selected row identifiers.
     */
  public declare selectedRowIds: string[];

  public declare presentedColumns: VioletPresentedColumn[];

  public declare presentedRows: VioletPresentedRow[];

  public declare renderedRows: VioletRenderedRow[];

    /**
     * Currently active data cell when cell focus mode is enabled.
     */
  public declare activeCell: VioletDataGridCellLocation | null;

    /**
     * Current rectangular cell selection when range selection is active.
     */
  public declare cellSelection: VioletDataGridCellRange | null;

    /**
     * Cell currently being edited.
     */
  public declare editingCell: VioletDataGridCellLocation | null;

  public declare editingValue: string;

  /** Accessible validation explanation for the active editor. */
  public declare editingError: string;

  /** Visible live feedback for terminal edit lifecycle events. */
  public declare editAnnouncement: string;

  public declare fillPreview: VioletDataGridCellRange | null;

    /**
   * Initial row-height estimate used before mounted rows are measured.
   * Defaults to the active density target (24px compact, 32px natural, 44px comfortable).
     */
  public declare estimatedRowHeight: number;

    /**
     * Number of rows to render outside the viewport in virtualized mode.
     */
  public declare overscanCount: number;

  public declare virtualPaddingStart: number;

  public declare virtualPaddingEnd: number;

  public declare virtualTotalSize: number;

  public declare hasToolbarSlotContent: boolean;

    /**
     * Column whose header holds the header row's roving Tab stop in row focus mode.
     * Falls back to the first column while unset or no longer presented.
     */
    public declare headerFocusColumnId: string | null;

    private readonly instanceId = ++violetDataGridInstanceCount;
    readonly #rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement>;
    #virtualizerCleanup: (() => void) | null = null;
    #virtualizerFrame: number | null = null;
  #rowMeasurementFrame: number | null = null;
    #pointerSelectionSession: VioletDataGridPointerSelectionSession<VioletDataGridCellLocation> =
        clearedPointerSelectionSession();
    #suppressNextGridClick = false;
    #nativeCopyPending = false;
    #fillSession: VioletDataGridFillSession<VioletDataGridCellRange> = clearedFillSession();
    #columnResizeReturnTarget: HTMLElement | null = null;
    #lastCellClickLocation: VioletDataGridCellLocation | null = null;
    #lastCellClickTimestamp = 0;
    #columnResizeSession: VioletDataGridResizeSession = clearedColumnResizeSession();
    #columnResizeHandle: HTMLElement | null = null;
    #measurementCanvas: HTMLCanvasElement | null = null;
  #rowIndexById = new Map<string, number>();
  #columnIndexById = new Map<string, number>();
  #selectedRowIdSet = new Set<string>();
  #columnRevision = 0;
  #rowPresentationCache = new Map<
    string,
    { source: VioletDataGridRow; columnRevision: number; row: VioletPresentedRow }
  >();
  #baseCellsByPresentedRow = new WeakMap<VioletPresentedRow, () => VioletPresentedCell[]>();
  #sortKeyCache = new Map<
    string,
    { source: VioletDataGridRow; column: VioletDataGridColumn; key: string }
  >();
  #decoratedRowCache = new Map<
    string,
    { source: VioletPresentedRow; interactionRevision: number; row: VioletPresentedRow }
  >();
  #presentationRevision = 0;
  #interactionRevision = 0;
  #renderedPresentationRevision = -1;
  #renderedInteractionRevision = -1;
  #automaticEstimatedRowHeight = true;
  #settingAutomaticEstimatedRowHeight = false;
  #editorRecycleInProgress = false;
  #editorRecycleFocusFrame: number | null = null;
  #focusGeneration = 0;
  #selectionControlFocusRevision = 0;
  #editorRestoreFrame: number | null = null;
  #editingEditorElement: VioletCellEditorLike | null = null;
  #nextEditingSessionId = 0;
  #editingSession: VioletDataGridEditingSession | null = null;
  #resolvingEditingSessionId: number | null = null;
  #presentationRetainingSessionId: number | null = null;
  #pendingEditorSelection: {
    sessionId: number;
    start: number;
    end: number;
    direction?: "forward" | "backward" | "none";
  } | null = null;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        this.selectionMode = "none";
        this.stickyHeader = false;
        this.busy = false;
        this.virtualize = false;
        this.density = "natural";
        this.focusMode = "row";
        this.sortMode = "local";
        this.columns = [];
        this.columnWidths = {};
        this.rows = [];
        this.showFilter = false;
        this.sort = null;
        this.filterState = {};
        this.selectedRowIds = [];
        this.presentedColumns = [];
        this.presentedRows = [];
        this.renderedRows = [];
        this.activeCell = null;
        this.cellSelection = null;
        this.editingCell = null;
        this.editingValue = "";
    this.editingError = "";
    this.editAnnouncement = "";
        this.fillPreview = null;
    this.#settingAutomaticEstimatedRowHeight = true;
    this.estimatedRowHeight = this.rowHeightForDensity(this.density);
    this.#settingAutomaticEstimatedRowHeight = false;
        this.overscanCount = 5;
        this.virtualPaddingStart = 0;
        this.virtualPaddingEnd = 0;
    this.virtualTotalSize = 0;
        this.hasToolbarSlotContent = false;
        this.headerFocusColumnId = null;
        this.#rowVirtualizer = new Virtualizer<HTMLDivElement, HTMLTableRowElement>({
            count: 0,
            getScrollElement: () => this.getScrollContainer(),
            estimateSize: () => this.estimatedRowHeight,
            scrollToFn: elementScroll,
            observeElementRect,
            observeElementOffset,
            overscan: this.overscanCount,
            getItemKey: (index: number) => this.presentedRows[index]?.id ?? index,
            enabled: false,
            onChange: () => {
                this.syncRenderedRows();
            },
        });
    }

    public connectedCallback(): void {
    this.refreshPresentation();
        super.connectedCallback();
    this.ownerDocument.addEventListener("focusin", this.#handleFocusIntent, true);
    this.ownerDocument.addEventListener("pointerdown", this.#handleFocusIntent, true);
        this.#virtualizerCleanup ??= this.#rowVirtualizer._didMount();
        this.hasToolbarSlotContent = this.querySelector('[slot="toolbar"]') !== null;
        this.syncHostStates();
        this.scheduleVirtualizerUpdate();
    }

    public disconnectedCallback(): void {
    // Consumers commit valid route transitions before detaching listeners.
    // Disconnect is the fail-safe terminal path for anything still active,
    // including invalid drafts that cannot remain in an invisible editor.
    this.cancelActiveEdit();
    this.ownerDocument.removeEventListener("focusin", this.#handleFocusIntent, true);
    this.ownerDocument.removeEventListener("pointerdown", this.#handleFocusIntent, true);
        if (this.#virtualizerFrame !== null) {
            cancelAnimationFrame(this.#virtualizerFrame);
            this.#virtualizerFrame = null;
        }
    if (this.#editorRecycleFocusFrame !== null) {
      cancelAnimationFrame(this.#editorRecycleFocusFrame);
      this.#editorRecycleFocusFrame = null;
    }
    this.#selectionControlFocusRevision += 1;
    if (this.#editorRestoreFrame !== null) {
      cancelAnimationFrame(this.#editorRestoreFrame);
      this.#editorRestoreFrame = null;
    }
    if (this.#rowMeasurementFrame !== null) {
      cancelAnimationFrame(this.#rowMeasurementFrame);
      this.#rowMeasurementFrame = null;
    }
    this.#rowVirtualizer.measureElement(null);
        this.#virtualizerCleanup?.();
        this.#virtualizerCleanup = null;
        super.disconnectedCallback();
    }

    public selectionModeChanged(): void {
        if (this.selectionMode === "none") {
            this.selectedRowIds = [];
            return;
        }

        if (this.selectionMode === "single" && this.selectedRowIds.length > 1) {
            this.selectedRowIds = this.selectedRowIds.slice(0, 1);
        }

    this.updateInteractionState();
    this.scheduleVirtualizerUpdate();
    }

    public stickyHeaderChanged(): void {
        this.syncHostStates();
    }

    public busyChanged(): void {
        this.syncHostStates();
    }

    public virtualizeChanged(): void {
        this.syncHostStates();
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
    }

    public focusModeChanged(): void {
        if (this.focusMode !== "cell") {
      this.cancelActiveEdit();
            this.activeCell = null;
            this.cellSelection = null;
            this.fillPreview = null;
            return;
        }

        if (!this.activeCell && this.presentedRows.length > 0 && this.presentedColumns.length > 0) {
            this.activeCell = this.firstCellLocation();
        }
    }

    public sortModeChanged(): void {
    this.schedulePresentationRefresh();
    }

    public columnsChanged(): void {
    this.captureActiveEditorSelection();
    this.cancelEditIfSourceTargetInvalidated();
    this.#presentationRetainingSessionId = this.#editingSession?.id ?? null;
    this.#columnRevision += 1;
    this.#sortKeyCache.clear();
    this.schedulePresentationRefresh();
    }

    public columnWidthsChanged(): void {
    this.#columnRevision += 1;
    this.schedulePresentationRefresh();
    }

    public rowsChanged(): void {
    if (this.rows.length === 0) {
      this.editAnnouncement = "";
    }
    this.captureActiveEditorSelection();
    this.cancelEditIfSourceTargetInvalidated();
    this.#presentationRetainingSessionId = this.#editingSession?.id ?? null;
    this.#rowPresentationCache.clear();
    this.#sortKeyCache.clear();
    this.schedulePresentationRefresh();
    }

    public showFilterChanged(): void {
    this.syncHostStates();
    }

    public sortChanged(): void {
    this.commitActiveEdit();
        this.clearRangeSelectionState();
    this.schedulePresentationRefresh();
    }

    public selectedRowIdsChanged(): void {
    this.#selectedRowIdSet = new Set(this.selectedRowIds ?? []);
    this.#interactionRevision += 1;
    this.syncRenderedRows();
    }

    public activeCellChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
        this.ensureActiveCellVisible();
        this.$emit("active-cell-change", this.activeCell);
    }

    public cellSelectionChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
        this.$emit("cell-selection-change", this.cellSelection);
    }

    public editingCellChanged(): void {
    if (!this.editingCell) {
      this.#editingSession = null;
      this.editingError = "";
    } else if (!this.sameEditingLocation(this.#editingSession?.location, this.editingCell)) {
      this.#editingSession = {
        id: ++this.#nextEditingSessionId,
        location: { ...this.editingCell },
      };
      this.editingError = "";
    }

        this.updateInteractionState();

    if (!this.editingCell || !this.#editingSession) {
            return;
        }

    this.scheduleEditorRestore(this.#editingSession.id);
    }

    public fillPreviewChanged(): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.updateInteractionState();
    }

    public estimatedRowHeightChanged(): void {
    if (!this.#settingAutomaticEstimatedRowHeight) {
      this.#automaticEstimatedRowHeight = false;
    }
    this.syncRenderedRows();
    this.scheduleVirtualizerUpdate();
  }

  public densityChanged(): void {
    if (this.#automaticEstimatedRowHeight) {
      this.#settingAutomaticEstimatedRowHeight = true;
      this.estimatedRowHeight = this.rowHeightForDensity(this.density);
      this.#settingAutomaticEstimatedRowHeight = false;
    }

        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
    }

    public overscanCountChanged(): void {
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
    }

    public get hasRows(): boolean {
        return this.presentedRows.length > 0;
    }

    public get columnSpan(): number {
    return this.presentedColumns.length + 1;
  }

  public get logicalRowCount(): number {
    return this.presentedRows.length + 1;
  }

  public get logicalColumnCount(): number {
        return this.presentedColumns.length + (this.selectionMode === "none" ? 0 : 1);
    }

  public get selectionHeaderId(): string {
    return `${this.localName}-selection-header-${this.instanceId}`;
  }

  public columnHeaderIdFor(columnId: string): string {
    return `${this.localName}-header-${this.instanceId}-${this.sanitizeForId(columnId)}`;
  }

    public get filterQuery(): string {
        return this.filterState.query ?? "";
    }

    public get showsBuiltInFilter(): boolean {
        return this.showFilter;
    }

    public get shouldShowToolbar(): boolean {
        return this.showsBuiltInFilter || this.hasToolbarSlotContent;
    }

    public get activeCellLabelId(): string {
        return `${this.localName}-active-cell-${this.instanceId}`;
    }

    public get activeCellDescription(): string {
        if (!this.activeCell) {
            return "No active cell.";
        }

    const rowIndex = this.#rowIndexById.get(this.activeCell.rowId) ?? -1;
    const columnIndex = this.#columnIndexById.get(this.activeCell.columnId) ?? -1;
        const columnLabel = this.presentedColumns[columnIndex]?.label ?? this.activeCell.columnId;
        const cellText = this.cellTextAt(this.activeCell) || "empty";

        return `Active cell row ${rowIndex + 1}, column ${columnLabel}, value ${cellText}.`;
    }

    public get rowSummary(): string {
        const totalRows = this.presentedRows.length;
    const selectedRows = this.selectedRowIds.filter((id) => this.#rowIndexById.has(id)).length;

        if (this.selectionMode === "none") {
            return `${totalRows} row${totalRows === 1 ? "" : "s"}`;
        }

        return `${selectedRows} selected / ${totalRows} row${totalRows === 1 ? "" : "s"}`;
    }

    public get selectionHeaderLabel(): string {
        if (this.selectionMode === "multiple") {
            return "Select rows";
        }

        return "Selected row";
    }

    public get selectionControlName(): string {
        return `${this.localName}-selection-${this.instanceId}`;
    }

    public get allRowsSelected(): boolean {
    const selectedRowIds = this.selectedRowIds ?? [];
    return (
      this.hasRows &&
      selectedRowIds.length >= this.presentedRows.length &&
      this.presentedRows.every((row) => this.#selectedRowIdSet.has(row.id))
    );
    }

    public get partiallySelected(): boolean {
    const selectedRowIds = this.selectedRowIds ?? [];
    if (selectedRowIds.length === 0) {
      return false;
    }

    const selectedCount = this.presentedRows.filter((row) =>
      this.#selectedRowIdSet.has(row.id),
    ).length;
        return selectedCount > 0 && selectedCount < this.presentedRows.length;
    }

    public sortStateFor(columnId: string): string {
        if (!this.sort || this.sort.columnId !== columnId) {
            return "none";
        }

        return this.sort.direction;
    }

    public sortDirectionFor(columnId: string): string {
        if (!this.sort || this.sort.columnId !== columnId) {
            return "ascending";
        }

        return this.sort.direction;
    }

    public isSortedColumn(columnId: string): boolean {
        return this.sort?.columnId === columnId;
    }

    public sortIconNameFor(columnId: string): string {
        return this.sortDirectionFor(columnId) === "descending"
            ? "system/sort-descending"
            : "system/sort-ascending";
    }

    public isRowSelected(rowId: string): boolean {
    return this.#selectedRowIdSet.has(rowId);
    }

    public selectionLabelFor(rowId: string, rowLabel?: string): string {
        const name = rowLabel?.trim() || rowId;
        const verb = this.selectionLabel?.trim();
        if (verb && this.selectionMode === "single") {
            return `${verb} ${name}`;
        }
        return `Select row ${name}`;
    }

    public handleToolbarSlotChange(event: Event): void {
        const slot = event.target as HTMLSlotElement | null;
        this.hasToolbarSlotContent = Boolean(slot?.assignedNodes({ flatten: true }).length);
    }

    public handleFilterInput(event: Event): void {
    const input = event.currentTarget as VioletTextFieldLike | null;
    if (this.editingCell && !this.commitActiveEdit()) {
      if (input) {
        input.value = this.filterState.query ?? "";
      }
      this.refocusActiveEditor();
      return;
    }
        const nextState: VioletDataGridFilterState = {
            ...this.filterState,
            query: input?.value ?? "",
        };

        this.clearRangeSelectionState();
        this.filterState = nextState;
        this.$emit("filter-change", nextState);
    }

    public handleSelectionControlPointerDown(event: PointerEvent): void {
        event.stopPropagation();
    }

    public handleSelectionControlClick(event: Event): void {
        event.stopPropagation();
    }

    public handleToggleAllCheckboxClick(event: Event): void {
        event.stopPropagation();
        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !this.allRowsSelected;

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

    this.updateSelection(nextChecked ? this.presentedRows.map((row) => row.id) : []);
    }

    public handleRowCheckboxClick(rowId: string, event: Event): void {
        event.stopPropagation();
        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !(checkbox?.checked ?? false);

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

        const current = new Set(this.selectedRowIds);
        if (nextChecked) {
            current.add(rowId);
        } else {
            current.delete(rowId);
        }

        this.updateSelection([...current]);
    }

    public handleCellCheckboxClick(rowId: string, columnId: string, event: Event): void {
        event.stopPropagation();

        const location = { rowId, columnId };
    if (
      this.editingCell &&
      !this.sameEditingLocation(this.editingCell, location) &&
      !this.commitActiveEdit()
    ) {
      this.refocusActiveEditor();
      return;
    }
        const cell = this.presentedCellAt(location);
        if (!cell?.editable || cell.editor !== "checkbox") {
            return;
        }

        const checkbox = event.currentTarget as VioletCheckboxLike | null;
        const nextChecked = !this.booleanCellValue(cell.rawValue);

        if (checkbox) {
            checkbox.checked = nextChecked;
            if ("indeterminate" in checkbox) {
                checkbox.indeterminate = false;
            }
        }

        this.commitCheckboxCellToggle(location, nextChecked);
    }

    public handleGridFocus(): void {
    if (
      this.focusMode !== "cell" ||
      this.activeCell ||
      !this.presentedRows.length ||
      !this.presentedColumns.length
    ) {
            return;
        }

        this.activeCell = this.firstCellLocation();
    }

    /**
     * Returns true to let the browser perform the key's default action.
     *
     * FAST cancels the default action of any `@event` binding whose expression
     * does not return exactly `true` (`HTMLBindingDirective.handleEvent`). A
     * `void` return therefore cancels every keystroke, including characters and
     * Backspace typed into an open cell editor. Return false only for keys this
     * handler consumes.
     */
    public handleGridKeydown(event: KeyboardEvent): boolean {
        if (this.focusMode !== "cell") {
            return true;
        }

    if (event.isComposing || event.keyCode === 229) {
      return true;
    }

        const target = event.target as HTMLElement | null;

        if (this.isEditorElement(target)) {
            if (event.key === "Enter") {
                event.preventDefault();
        if (this.commitActiveEdit()) {
                this.getScrollContainer()?.focus({ preventScroll: true });
        } else {
          this.refocusActiveEditor();
        }
                return false;
            }

            if (event.key === "Tab") {
                event.preventDefault();
                this.commitEditingCellAndMove(event.shiftKey ? -1 : 1);
                return false;
            }

            if (event.key === "Escape") {
                event.preventDefault();
        this.cancelActiveEdit();
                this.getScrollContainer()?.focus({ preventScroll: true });
                return false;
            }

            // Every other key belongs to the editor: typing, Backspace, caret
            // movement. Cancelling here is what made cell editing impossible.
            return true;
        }

        if (target && target !== this.getScrollContainer()) {
            return true;
        }

        if (isColumnResizeShortcut(event) && this.activeCell) {
            event.preventDefault();
            return !this.focusColumnResizer(this.activeCell.columnId, this.getScrollContainer());
        }

        if (event.key === "Tab") {
            const currentCell = this.activeCell ?? this.firstCellLocation();
            if (!currentCell) {
                return true;
            }

            const nextLocation = this.nextTabCellLocation(currentCell, event.shiftKey ? -1 : 1);
            if (!nextLocation) {
                return true;
            }

            event.preventDefault();
            this.setActiveCell(nextLocation);
            return false;
        }

    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "c"
    ) {
            // Let the browser run its native copy so `handleGridCopy` can write through
            // `clipboardData` (works in insecure contexts and Safari). If no copy event
            // follows, fall back to the async clipboard API.
            this.#nativeCopyPending = true;
            setTimeout(() => {
                if (!this.#nativeCopyPending) {
                    return;
                }
                this.#nativeCopyPending = false;
                void this.handleCopyRequest();
            }, 0);
            return true;
        }

    if (
      (event.key === " " || event.key === "Spacebar" || event.key === "Enter") &&
      this.activeCell
    ) {
            const activeCell = this.presentedCellAt(this.activeCell);
            if (activeCell?.editable && activeCell.editor === "checkbox") {
                event.preventDefault();
                this.commitCheckboxCellToggle(this.activeCell, !this.booleanCellValue(activeCell.rawValue));
                return false;
            }
        }

        if ((event.key === "Enter" || event.key === "F2") && this.activeCell) {
            const editableCell = this.presentedCellAt(this.activeCell);
            if (!editableCell?.editable) {
                return true;
            }

            event.preventDefault();
            this.startEditingCell(this.activeCell);
            return false;
        }

        if (
            event.key === "ArrowUp" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            this.activeCell &&
            this.activeCell.rowId === this.presentedRows[0]?.id
        ) {
            const header = this.columnHeaderFocusTargetFor(this.activeCell.columnId);
            if (header) {
                event.preventDefault();
                header.focus();
                return false;
            }
        }

        const nextLocation = this.nextCellLocationForKey(event);
        if (!nextLocation) {
            return true;
        }

        event.preventDefault();
        this.setActiveCell(nextLocation, { extendRange: event.shiftKey });
        return false;
    }

    public handleGridClick(event: Event): boolean {
        if (this.focusMode !== "cell") {
            return true;
        }

        if (this.#suppressNextGridClick) {
            this.#suppressNextGridClick = false;
            return true;
        }

        const target = event.target as HTMLElement | null;
        if (
            this.isEditorEvent(event) ||
            this.isEditorElement(target) ||
            this.isInteractiveCellWidgetEvent(event) ||
            this.isInteractiveCellWidgetTarget(target)
        ) {
            return true;
        }

        const pointerEvent = event as MouseEvent;
        const location =
            this.locationFromMouseEvent(pointerEvent) ??
            this.locationFromEvent(event) ??
            this.locationFromTarget(target);
        if (!location) {
            if (pointerEvent.detail >= 2 && this.activeCell) {
                const activeCell = this.presentedCellAt(this.activeCell);
                if (activeCell?.editable && activeCell.editor !== "checkbox") {
                    this.startEditingCell(this.activeCell);
                }
            }
            return true;
        }

    if (
      this.editingCell &&
      !this.sameEditingLocation(this.editingCell, location) &&
      !this.commitActiveEdit()
    ) {
      this.refocusActiveEditor();
            return true;
        }

        const sameActiveCell =
            this.activeCell?.rowId === location.rowId && this.activeCell?.columnId === location.columnId;
        const activeCell = this.presentedCellAt(location);

        if (
            sameActiveCell &&
            activeCell?.editable &&
            this.opensOnSingleActiveClick(activeCell.editor)
        ) {
            this.startEditingCell(location);
            return true;
        }

        this.handleCellPointerActivate(location.rowId, location.columnId, pointerEvent.shiftKey);

    const timestamp =
      typeof pointerEvent.timeStamp === "number" ? pointerEvent.timeStamp : performance.now();
        const sameCellAsLastClick =
            this.#lastCellClickLocation?.rowId === location.rowId &&
            this.#lastCellClickLocation?.columnId === location.columnId;
        const withinDoubleClickWindow = timestamp - this.#lastCellClickTimestamp <= 350;

        if (pointerEvent.detail >= 2 || (sameCellAsLastClick && withinDoubleClickWindow)) {
            const cell = this.presentedCellAt(location);
            if (cell?.editable && cell.editor !== "checkbox") {
                this.startEditingCell(location);
            }
        }

        this.#lastCellClickLocation = location;
        this.#lastCellClickTimestamp = timestamp;
        return true;
    }

    public handleGridDoubleClick(event: MouseEvent): boolean {
        if (this.focusMode !== "cell") {
            return true;
        }

        const target = event.target as HTMLElement | null;
        if (
            (!target && !this.locationFromEvent(event)) ||
            this.isEditorEvent(event) ||
            this.isEditorElement(target) ||
      this.isInteractiveCellWidgetEvent(event) ||
      this.isInteractiveCellWidgetTarget(target) ||
            this.isFillHandleEvent(event) ||
            this.isFillHandleTarget(target)
        ) {
            return true;
        }

        const location =
            this.locationFromMouseEvent(event) ??
            this.locationFromEvent(event) ??
            this.locationFromTarget(target);
        if (!location) {
            if (this.activeCell) {
                const activeCell = this.presentedCellAt(this.activeCell);
                if (activeCell?.editable && activeCell.editor !== "checkbox") {
                    event.preventDefault();
                    this.startEditingCell(this.activeCell);
                    return false;
                }
            }
            return true;
        }

        const cell = this.presentedCellAt(location);
        if (cell?.editor === "checkbox") {
            return true;
        }

        event.preventDefault();
        this.handleCellPointerActivate(location.rowId, location.columnId, false);
        this.startEditingCell(location);
        return false;
    }

    public handleGridPointerDown(event: PointerEvent): boolean {
        if (
            this.focusMode !== "cell" ||
            event.button !== 0 ||
            event.shiftKey ||
            this.isEditorEvent(event) ||
            this.isEditorElement(event.target) ||
            this.isInteractiveCellWidgetEvent(event) ||
            this.isInteractiveCellWidgetTarget(event.target)
        ) {
            return true;
        }

        if (this.isFillHandleEvent(event) || this.isFillHandleTarget(event.target)) {
            this.beginFillDrag(event);
            return false;
        }

        const location = this.locationFromEvent(event) ?? this.locationFromTarget(event.target);
        if (!location) {
            return true;
        }

        const scrollContainer = this.getScrollContainer();

        this.#pointerSelectionSession = startPointerSelectionSession(event.pointerId, location);
        this.setActiveCell(location);
        scrollContainer?.focus({ preventScroll: true });
        try {
            scrollContainer?.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic Storybook pointer events do not always create a capturable pointer.
        }
        event.preventDefault();
        return false;
    }

    public handleGridPointerMove(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            this.handleFillPointerMove(event);
            return;
        }

        const session = this.#pointerSelectionSession;
    if (this.focusMode !== "cell" || !isPointerSelectionEventForSession(session, event.pointerId)) {
            return;
        }

        const location = this.locationFromPointerEvent(event);
        if (!location) {
            return;
        }

        const anchor = session.anchor;
        if (!anchor) {
            return;
        }

        const currentFocus = this.cellSelection?.focus ?? anchor;
        if (currentFocus.rowId === location.rowId && currentFocus.columnId === location.columnId) {
            return;
        }

        this.#pointerSelectionSession = markPointerSelectionMoved(session);
        this.cellSelection = this.createCellSelection(anchor, location);
        this.updateInteractionState();
    }

    public handleGridPointerUp(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            this.handleFillPointerUp();
            return;
        }

        if (!isPointerSelectionEventForSession(this.#pointerSelectionSession, event.pointerId)) {
            return;
        }

        this.endPointerSelection(true);
    }

    public handleGridPointerCancel(event: PointerEvent): void {
        if (isFillPointerEventForSession(this.#fillSession, event.pointerId)) {
            this.endFillDrag(false);
            return;
        }

        if (!isPointerSelectionEventForSession(this.#pointerSelectionSession, event.pointerId)) {
            return;
        }

        this.endPointerSelection(false);
    }

    public handleGridInput(event: Event): void {
        const target = event.target as HTMLElement | null;
        if (!this.isEditorElement(target) || !this.editingCell) {
            return;
        }

        this.editingValue = this.editorValueFromTarget(target);
    if (this.editingError) {
      this.editingError = "";
      this.updateInteractionState();
      this.scheduleEditorRestore(this.#editingSession?.id ?? null);
    }
    }

    public handleGridChange(event: Event): void {
        const target = event.target as HTMLElement | null;

        if (this.isEditorElement(target) && this.editingCell) {
            this.editingValue = this.editorValueFromTarget(target);
            const cell = this.presentedCellAt(this.editingCell);
            if (cell?.editor === "select" || target.dataset.commitOnChange === "true") {
        if (this.commitActiveEdit()) {
                this.getScrollContainer()?.focus({ preventScroll: true });
        } else {
          this.refocusActiveEditor();
        }
            }
            return;
        }
    }

    public handleGridPaste(event: ClipboardEvent): boolean {
    if (
      this.focusMode !== "cell" ||
      this.isEditorEvent(event) ||
      this.isEditorElement(event.target)
    ) {
            return true;
        }

        const text = event.clipboardData?.getData("text/plain") ?? "";
        const detail = this.pasteDetailForText(text);
        if (!detail) {
            return true;
        }

        event.preventDefault();
        this.$emit("cell-paste", detail);
        return false;
    }

    public handleGridFocusOut(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        if (!this.isEditorElement(target)) {
            return;
        }
    const sessionId = this.#editingSession?.id ?? null;
    const relatedTarget = (event as FocusEvent).relatedTarget;
    if (this.isTargetWithinEditingOwnership(relatedTarget)) {
      return;
    }
    // A concrete outside target is an intentional focus transfer. Resolve it
    // before a pending row refresh can mistake the departure for DOM recycling.
    if (relatedTarget) {
      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
      }
      return;
    }
    if (sessionId && this.#presentationRetainingSessionId === sessionId) {
      this.captureEditorSelection(target, sessionId);
      this.scheduleEditorRestore(sessionId, true);
      return;
    }

        requestAnimationFrame(() => {
      if (!this.editingCell || !sessionId || this.#editingSession?.id !== sessionId) {
                return;
            }

            const currentEditor = this.getActiveEditorElement();
      if (currentEditor && currentEditor !== target) {
        seedEditorValue(currentEditor, this.editingValue);
        this.restoreEditorSelection(currentEditor, sessionId);
        return;
      }

      if (
        this.#presentationRetainingSessionId === sessionId &&
        currentEditor !== target &&
        this.presentedCellAt(this.#editingSession.location)?.editable
      ) {
        this.captureEditorSelection(target, sessionId);
        this.scheduleEditorRestore(sessionId, true);
        return;
      }

            if (currentEditor?.matches?.(":focus-within")) {
                return;
            }

      const editorShadowActiveElement = (
        currentEditor as (HTMLElement & { shadowRoot?: ShadowRoot | null }) | null
      )?.shadowRoot?.activeElement;
            if (editorShadowActiveElement) {
                return;
            }

            const activeElement = this.shadowRoot?.activeElement as Element | null;
            if (activeElement && this.isEditorElement(activeElement)) {
                return;
            }

      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
      }
        });
    }

    public async handleCopyRequest(): Promise<void> {
        const detail = this.copyDetailForCurrentSelection();
        if (!detail) {
            return;
        }

        this.$emit("cell-copy", detail);

        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard?.writeText) {
            this.$emit("cell-copy-error", { ...detail, error: new Error("Clipboard API is unavailable.") });
            return;
        }

        try {
            await clipboard.writeText(detail.text);
        } catch (error) {
            this.$emit("cell-copy-error", { ...detail, error });
        }
    }

    /** Handles the native `copy` event, writing TSV through `clipboardData`. */
    public handleGridCopy(event: ClipboardEvent): boolean {
        if (
            this.focusMode !== "cell" ||
            this.isEditorEvent(event) ||
            this.isEditorElement(event.target)
        ) {
            return true;
        }

        this.#nativeCopyPending = false;
        const detail = this.copyDetailForCurrentSelection();
        if (!detail || !event.clipboardData) {
            return true;
        }

        event.clipboardData.setData("text/plain", detail.text);
        event.preventDefault();
        this.$emit("cell-copy", detail);
        return false;
    }

    public handleSortRequest(columnId: string): void {
    if (this.editingCell && !this.commitActiveEdit()) {
      this.refocusActiveEditor();
      return;
    }
        const currentDirection = this.sort?.columnId === columnId ? this.sort.direction : null;
        let nextSort: VioletDataGridSort | null;

        if (currentDirection === null) {
            nextSort = { columnId, direction: "ascending" };
        } else if (currentDirection === "ascending") {
            nextSort = { columnId, direction: "descending" };
        } else {
            nextSort = null;
        }

        this.sort = nextSort;
        this.$emit("sort-change", nextSort);
    }

    public handleColumnResizePointerDown(columnId: string, event: PointerEvent): void {
        const session = startColumnResizeSession({
            button: event.button,
            pointerId: event.pointerId,
            columnId,
            clientX: event.clientX,
            startWidth: this.renderedColumnWidth(columnId),
        });

        if (!session) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const handle = event.currentTarget as HTMLElement | null;
        this.#columnResizeSession = session;
        this.#columnResizeHandle = handle;

        try {
            handle?.setPointerCapture(event.pointerId);
        } catch {
            // Ignore capture failures for synthetic Storybook pointer events.
        }
    }

    public handleColumnResizePointerMove(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const width = computeResizedColumnWidth({
            session,
            clientX: event.clientX,
            minimumWidth: this.minimumColumnWidth(session.columnId),
        });

        this.applyLiveColumnWidth(session.columnId, `${width}px`);
    }

    public handleColumnResizePointerUp(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const width = computeResizedColumnWidth({
            session,
            clientX: event.clientX,
            minimumWidth: this.minimumColumnWidth(session.columnId),
        });

        this.commitColumnWidth(session.columnId, `${width}px`);
        this.endColumnResize();
    }

    public handleColumnResizePointerCancel(event: PointerEvent): void {
        const session = this.#columnResizeSession;
        if (!isColumnResizeEventForSession(session, event.pointerId) || !session.columnId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.applyLiveColumnWidth(session.columnId, this.resolvedColumnWidth(session.columnId));
        this.endColumnResize();
    }

    public handleColumnResizeKeyDown(columnId: string, event: KeyboardEvent): boolean {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.returnFocusFromColumnResizer(columnId);
            return false;
        }

        if (event.key === "Tab") {
            // Resizers are not Tab stops: Tab continues from where Ctrl+Alt+R came from.
            this.returnFocusFromColumnResizer(columnId);
            return true;
        }

        if (event.altKey || event.ctrlKey || event.metaKey) {
            return true;
        }

        if (event.key === "Enter") {
            this.handleColumnResizeDoubleClick(columnId, event);
            return false;
        }

        const width = computeKeyboardResizedColumnWidth({
            key: event.key,
            shiftKey: event.shiftKey,
            currentWidth: this.renderedColumnWidth(columnId),
            minimumWidth: this.minimumColumnWidth(columnId),
            rtl: getComputedStyle(this).direction === "rtl",
        });

        if (width === null) {
            return true;
        }

        event.preventDefault();
        event.stopPropagation();
        this.applyLiveColumnWidth(columnId, `${width}px`);
        this.commitColumnWidth(columnId, `${width}px`);
        return false;
    }

    /**
     * Tab index for a column header's focus target: its sort button, or the header cell when it is not
     * sortable. Row focus mode keeps one header in the tab order; cell focus mode keeps none, because the
     * grid itself is the Tab stop.
     */
    public columnHeaderTabIndexFor(columnId: string): string {
        if (this.focusMode === "cell") {
            return "-1";
        }

        const columns = this.presentedColumns;
        const tabStopColumnId = columns.some((column) => column.id === this.headerFocusColumnId)
            ? this.headerFocusColumnId
            : columns[0]?.id;
        return columnId === tabStopColumnId ? "0" : "-1";
    }

    public handleColumnHeaderFocus(columnId: string, event: FocusEvent): void {
        if (event.target === this.columnHeaderFocusTargetFor(columnId)) {
            this.headerFocusColumnId = columnId;
        }
    }

    /**
     * Handles keydown on a column header: the arrow keys, Home and End move between headers, ArrowDown
     * returns to the first row in cell focus mode, Shift+Tab returns to the active cell in cell focus mode,
     * and Ctrl+Alt+R moves focus to the column's resizer. Enter and Space reach the sort button natively.
     */
    public handleColumnHeaderKeydown(columnId: string, event: KeyboardEvent): boolean {
        const header = this.columnHeaderFocusTargetFor(columnId);
        // Keys pressed on the column's resizer bubble through the header cell.
        if (!header || event.target !== header) {
            return true;
        }

        if (isColumnResizeShortcut(event)) {
            event.preventDefault();
            return !this.focusColumnResizer(columnId, header);
        }

        if (event.altKey || event.ctrlKey || event.metaKey) {
            return true;
        }

        if (event.key === "Tab") {
            if (!event.shiftKey || this.focusMode !== "cell") {
                return true;
            }

            // The header sits above the body within the grid's single Tab stop.
            event.preventDefault();
            this.getScrollContainer()?.focus({ preventScroll: true });
            return false;
        }

        if (event.shiftKey) {
            return true;
        }

        const columns = this.presentedColumns;
        const columnIndex = columns.findIndex((column) => column.id === columnId);
        let nextColumnId: string | undefined;

        switch (logicalArrowKey(event.key, this)) {
            case "ArrowLeft":
                nextColumnId = columns[Math.max(0, columnIndex - 1)]?.id;
                break;
            case "ArrowRight":
                nextColumnId = columns[Math.min(columns.length - 1, columnIndex + 1)]?.id;
                break;
            case "Home":
                nextColumnId = columns[0]?.id;
                break;
            case "End":
                nextColumnId = columns.at(-1)?.id;
                break;
            case "ArrowDown":
                return this.focusFirstRowFromHeader(columnId, event);
            default:
                return true;
        }

        event.preventDefault();
        if (nextColumnId) {
            this.columnHeaderFocusTargetFor(nextColumnId)?.focus();
        }
        return false;
    }

    public handleColumnResizeDoubleClick(columnId: string, event: Event): void {
        event.preventDefault();
        event.stopPropagation();

        const width = `${this.autosizedColumnWidth(columnId)}px`;
        this.applyLiveColumnWidth(columnId, width);
        this.commitColumnWidth(columnId, width);
    }

    private columnResizerFor(columnId: string): HTMLButtonElement | null {
        return (
            this.shadowRoot?.querySelector<HTMLButtonElement>(
                `[data-column-resizer="${CSS.escape(columnId)}"]`,
            ) ?? null
        );
    }

    /**
     * The element that takes focus for a column header: its sort button, or the header cell itself.
     */
    private columnHeaderFocusTargetFor(columnId: string): HTMLElement | null {
        const header = this.shadowRoot?.querySelector<HTMLTableCellElement>(
            `th[data-column-id="${CSS.escape(columnId)}"]`,
        );
        if (!header) {
            return null;
        }

        return header.querySelector<HTMLElement>(".header-button") ?? header;
    }

    private focusFirstRowFromHeader(columnId: string, event: KeyboardEvent): boolean {
        const rowId = this.presentedRows[0]?.id;
        if (this.focusMode !== "cell" || !rowId) {
            return true;
        }

        event.preventDefault();
        this.setActiveCell({ rowId, columnId });
        this.getScrollContainer()?.focus({ preventScroll: true });
        return false;
    }

    private focusColumnResizer(columnId: string, returnTarget: HTMLElement | null): boolean {
        const resizer = this.columnResizerFor(columnId);
        if (!resizer) {
            return false;
        }

        this.#columnResizeReturnTarget = returnTarget;
        resizer.focus();
        return true;
    }

    private returnFocusFromColumnResizer(columnId: string): void {
        const returnTarget = this.#columnResizeReturnTarget;
        this.#columnResizeReturnTarget = null;
        const fallback = this.columnHeaderFocusTargetFor(columnId) ?? this.getScrollContainer();
        (returnTarget?.isConnected ? returnTarget : fallback)?.focus({ preventScroll: true });
    }

    public handleToggleAll(event: Event): void {
        const input = event.currentTarget as VioletCheckboxLike | null;
    const nextSelected = input?.checked ? this.presentedRows.map((row) => row.id) : [];
        this.updateSelection(nextSelected);
    }

    public handleRowSelection(rowId: string, event: Event): void {
        if (this.selectionMode === "none") {
            return;
        }

        const input = event.currentTarget as HTMLInputElement | VioletCheckboxLike | null;
        const checked = Boolean(input?.checked);

        if (this.selectionMode === "single") {
            this.updateSelection(checked ? [rowId] : []);
            return;
        }

        const current = new Set(this.selectedRowIds);
        if (checked) {
            current.add(rowId);
        } else {
            current.delete(rowId);
        }
        this.updateSelection([...current]);
    }

    public handleCellPointerActivate(rowId: string, columnId: string, extendRange = false): void {
        if (this.focusMode !== "cell") {
            return;
        }

        this.editAnnouncement = "";
        this.setActiveCell({ rowId, columnId }, { extendRange });
        this.getScrollContainer()?.focus({ preventScroll: true });
    }

    private updateSelection(nextSelectedRowIds: string[]): void {
        const uniqueSelected = [...new Set(nextSelectedRowIds)];
        this.selectedRowIds = uniqueSelected;
        this.$emit("selection-change", { selectedRowIds: uniqueSelected });
    }

    private clearRangeSelectionState(): void {
        // Row selection is keyed by row id, so it intentionally survives sort and
        // filter changes; only the positional range/fill state is reset here.
        if (this.cellSelection) {
            this.cellSelection = null;
        }

        if (this.fillPreview) {
            this.fillPreview = null;
        }
    }

    private commitColumnWidth(columnId: string, width: string): void {
        const nextWidths = {
            ...(this.columnWidths ?? {}),
            [columnId]: width,
        };

        this.columnWidths = nextWidths;
        this.$emit("column-width-change", {
            columnId,
            width,
            columnWidths: nextWidths,
        } satisfies VioletDataGridColumnWidthDetail & { columnWidths: Record<string, string> });
    }

    private endColumnResize(): void {
        if (
            this.#columnResizeHandle &&
            this.#columnResizeSession.pointerId !== null &&
            this.#columnResizeHandle.hasPointerCapture?.(this.#columnResizeSession.pointerId)
        ) {
            try {
                this.#columnResizeHandle.releasePointerCapture(this.#columnResizeSession.pointerId);
            } catch {
                // Ignore release failures for synthetic Storybook pointer events.
            }
        }

        this.#columnResizeSession = clearedColumnResizeSession();
        this.#columnResizeHandle = null;
    }

  private schedulePresentationRefresh(): void {
    if (!this.$fastController.isConnected) {
      return;
    }
    this.refreshPresentation();
  }

    private refreshPresentation(): void {
    this.#presentationRevision += 1;
        const sourceColumns = this.columns ?? [];
        const sourceRows = this.rows ?? [];
        const sourceSelectedRowIds = this.selectedRowIds ?? [];
    const presentedColumns = sourceColumns.map((column) => this.createPresentedColumn(column));
        const sortedRows = this.sortRows(sourceRows, presentedColumns);
    const validSelectedIds = new Set(sortedRows.map((row) => row.id));
    const sourceRowsById = new Map(sourceRows.map((row) => [row.id, row]));
    const prunedSelection = sourceSelectedRowIds.filter((id) => validSelectedIds.has(id));

        if (prunedSelection.length !== sourceSelectedRowIds.length) {
            this.selectedRowIds = prunedSelection;
            this.$emit("selection-change", { selectedRowIds: prunedSelection });
        }

        this.presentedColumns = presentedColumns;
    this.#columnIndexById = new Map(presentedColumns.map((column, index) => [column.id, index]));
    this.#rowIndexById = new Map(sortedRows.map((row, index) => [row.id, index]));
    this.#selectedRowIdSet = new Set(prunedSelection);
    this.presentedRows = sortedRows.map((row) => this.createPresentedRow(row, presentedColumns));

    for (const [rowId, cached] of this.#rowPresentationCache) {
      if (!validSelectedIds.has(rowId) || sourceRowsById.get(rowId) !== cached.source) {
        this.#rowPresentationCache.delete(rowId);
      }
    }
    for (const [rowId, cached] of this.#sortKeyCache) {
      if (!validSelectedIds.has(rowId) || sourceRowsById.get(rowId) !== cached.source) {
        this.#sortKeyCache.delete(rowId);
      }
    }

        this.syncActiveCell();
        this.syncCellSelection();
        this.syncEditingCell();
        this.syncFillPreview();
        this.updateInteractionState();
        this.syncRenderedRows();
        this.scheduleVirtualizerUpdate();
        this.syncHostStates();
    }

    private createPresentedColumn<RowData>(
    column: VioletDataGridColumn<RowData>,
    ): VioletPresentedColumn<RowData> {
        return buildPresentedColumn(column, {
            resolvedWidth: this.columnWidths?.[column.id] ?? column.width,
            mergePartNames: (base, extra) => this.mergePartNames(base, extra),
        }) as VioletPresentedColumn<RowData>;
    }

    private createPresentedRow<RowData>(
        row: VioletDataGridRow<RowData>,
    columns: VioletPresentedColumn<RowData>[],
    ): VioletPresentedRow<RowData> {
    const cached = this.#rowPresentationCache.get(row.id);
    if (cached?.source === row && cached.columnRevision === this.#columnRevision) {
      return cached.row as VioletPresentedRow<RowData>;
    }

    const rowLabel = row.label?.trim() || row.id;
    let materializedCells: VioletPresentedCell[] | null = null;
    const presentedRow = {
      id: row.id,
      label: rowLabel,
      data: row.data,
    } as VioletPresentedRow<RowData>;
    const baseCells = (): VioletPresentedCell[] => {
      if (!materializedCells) {
        materializedCells = (
          buildPresentedRow(row, columns, {
            cellValueFor: (rowValue, column) => this.cellValueFor(rowValue, column),
            serializeCellValue: (column, rowData, rawValue) =>
              this.serializeCellValue(column, rowData, rawValue),
            cellIdFor: (rowId, columnId) => this.cellIdFor(rowId, columnId),
            editingErrorIdFor: (rowId, columnId) => this.cellEditorErrorIdFor(rowId, columnId),
            editorOptionsForColumn: (column, rowData) =>
              this.editorOptionsForColumn(column, rowData),
          }) as VioletPresentedRow<RowData>
        ).cells;
      }

      return materializedCells;
    };

    this.#baseCellsByPresentedRow.set(presentedRow as VioletPresentedRow, baseCells);

    Object.defineProperty(presentedRow, "cells", {
      configurable: false,
      enumerable: true,
      get: () => {
        const cells = baseCells();
        if (this.focusMode !== "cell") {
          return cells;
        }

        const rowIndex = this.#rowIndexById.get(row.id);
        if (rowIndex === undefined) {
          return cells;
        }

        return this.withInteractionState(presentedRow, rowIndex, this.interactionSnapshot()).cells;
      },
    });

    this.#rowPresentationCache.set(row.id, {
      source: row as VioletDataGridRow,
      columnRevision: this.#columnRevision,
      row: presentedRow as VioletPresentedRow,
    });
    return presentedRow;
    }

    private updateInteractionState(): void {
    this.#interactionRevision += 1;
        this.syncRenderedRows();
    }

  private withInteractionState<RowData>(
    row: VioletPresentedRow<RowData>,
    rowIndex: number,
    snapshot: VioletInteractionSnapshot,
  ): VioletPresentedRow<RowData> {
    if (this.focusMode !== "cell") {
      return row;
    }

    const cached = this.#decoratedRowCache.get(row.id);
    if (cached?.source === row && cached.interactionRevision === this.#interactionRevision) {
      return cached.row as VioletPresentedRow<RowData>;
    }

    const baseCells = this.#baseCellsByPresentedRow.get(row)?.() ?? row.cells;
    const decoratedRow = {
      id: row.id,
      label: row.label,
      data: row.data,
      cells: baseCells.map((cell, columnIndex) => {
        const indices = { rowIndex, columnIndex };
        const selected = computeIsCellSelected(snapshot.selectionBounds, indices);
        const rangeEdge = computeRangeEdgeForCell(snapshot.selectionBounds, indices);
        const fillPreview = computeIsFillPreviewCell(
          snapshot.fillPreviewBounds,
          snapshot.fillSourceBounds,
          indices,
        );
        const active = this.isActiveCell(cell.rowId, cell.columnId);
        const editing = this.isEditingCell(cell.rowId, cell.columnId);

        return {
          ...cell,
          active,
          selected,
          fillPreview,
          rangeEdge,
          editing,
          editValue: editing ? this.editingValue : "",
          editingError: editing ? this.editingError : "",
          resolvedCellPartText: composeCellPartText(cell.cellPartText, {
            selected,
            rangeEdge,
            fillPreview,
            active,
            editing,
          }),
        };
      }),
    };
    this.#decoratedRowCache.set(row.id, {
      source: row as VioletPresentedRow,
      interactionRevision: this.#interactionRevision,
      row: decoratedRow as VioletPresentedRow,
    });
    return decoratedRow;
    }

    private resolvedColumnWidth(columnId: string): string | undefined {
        return resolveGridColumnWidth(columnId, this.columnWidths, this.columns);
    }

    private renderedColumnWidth(columnId: string): number {
        const headerCell = this.headerCellElement(columnId);
        return computeRenderedColumnWidth({
            headerCell,
            resolvedWidth: this.resolvedColumnWidth(columnId),
        });
    }

    private minimumColumnWidth(columnId: string): number {
        const headerCell = this.headerCellElement(columnId);
        return computeMinimumColumnWidth(headerCell);
    }

    private applyLiveColumnWidth(columnId: string, width: string | undefined): void {
        const value = width ?? "";
        const rowId = CSS.escape(columnId);

    this.shadowRoot?.querySelectorAll(`[data-column-id="${rowId}"]`).forEach((element) => {
                const style = (element as HTMLElement).style;
                style.width = value;
                style.inlineSize = value;
                style.minInlineSize = value;
                style.maxInlineSize = value;
            });
    }

    private headerCellElement(columnId: string): HTMLTableCellElement | null {
        const escaped = CSS.escape(columnId);
    return this.shadowRoot?.querySelector(
      `th[data-column-id="${escaped}"]`,
    ) as HTMLTableCellElement | null;
    }

    private autosizedColumnWidth(columnId: string): number {
    const columnIndex = this.#columnIndexById.get(columnId);
    const column = columnIndex === undefined ? undefined : this.presentedColumns[columnIndex];
        const headerCell = this.headerCellElement(columnId);
        const sampleCell = this.cellElementForLocation(
      this.presentedRows[0] ? { rowId: this.presentedRows[0].id, columnId } : null,
        );
    if (!this.#measurementCanvas) {
      this.#measurementCanvas = document.createElement("canvas");
    }
    const canvas = this.#measurementCanvas;
        return computeAutosizedColumnWidth({
            columnId,
            column: column ?? null,
            rows: this.presentedRows,
            headerCell,
            sampleCell,
      getCellText: (location) => this.cellTextAt(location),
            sampleRows: sampleAutosizeRows(this.presentedRows),
            measurementCanvas: canvas,
        });
    }

    private cellValueFor<RowData>(
        row: VioletDataGridRow<RowData>,
    column: VioletPresentedColumn<RowData>,
    ): unknown {
        return resolveCellValue(row, column.source);
    }

    private editorOptionsForColumn<RowData>(
        column: VioletDataGridColumn<RowData>,
    rowData: RowData,
    ): VioletDataGridEditorOption[] {
    return resolveEditorOptionsForColumn<RowData, VioletDataGridEditorOption>(column, rowData);
    }

    private serializeCellValue<RowData>(
        column: VioletDataGridColumn<RowData>,
        rowData: RowData,
    rawValue: unknown,
    ): string {
        return serializeGridCellValue({
            column,
            rowData,
            rawValue,
      booleanCellValue: (value) => this.booleanCellValue(value),
        });
    }

    private sortRows<RowData>(
        rows: VioletDataGridRow<RowData>[] | undefined,
    columns: VioletPresentedColumn<RowData>[],
    ): VioletDataGridRow<RowData>[] {
        return sortGridRows({
            rows,
      columns: columns.map((column) => column.source),
            sort: this.sort,
            sortMode: this.sortMode,
      getSortKey: (row, column) => this.sortKeyFor(row, column as VioletDataGridColumn<RowData>),
        });
    }

  private sortKeyFor<RowData>(
    row: VioletDataGridRow<RowData>,
    column: VioletDataGridColumn<RowData>,
  ): string {
    const cached = this.#sortKeyCache.get(row.id);
    if (cached?.source === row && cached.column === column) {
      return cached.key;
    }

    const key = stringifyCellValue(resolveCellValue(row, column));
    this.#sortKeyCache.set(row.id, {
      source: row as VioletDataGridRow,
      column: column as VioletDataGridColumn,
      key,
    });
    return key;
  }

    private syncActiveCell(): void {
        this.activeCell = syncPresentedActiveCell({
            focusMode: this.focusMode,
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
        }) as VioletDataGridCellLocation | null;
    }

    private syncCellSelection(): void {
        this.cellSelection = syncPresentedCellSelection({
            focusMode: this.focusMode,
            activeCell: this.activeCell,
            cellSelection: this.cellSelection,
      isValidLocation: (location) => this.isValidCellLocation(location),
        }) as VioletDataGridCellRange | null;
    }

    private syncFillPreview(): void {
        this.fillPreview = syncPresentedFillPreview({
            focusMode: this.focusMode,
            fillPreview: this.fillPreview,
      isValidLocation: (location) => this.isValidCellLocation(location),
        }) as VioletDataGridCellRange | null;
    }

    private syncEditingCell(): void {
        const nextState = syncEditingState({
            focusMode: this.focusMode,
            editingCell: this.editingCell,
            editingValue: this.editingValue,
      isEditableLocation: (location) => Boolean(this.presentedCellAt(location)?.editable),
        });

    if (this.editingCell && !nextState.editingCell) {
      this.cancelActiveEdit();
      return;
    }
        this.editingCell = nextState.editingCell as VioletDataGridCellLocation | null;
        this.editingValue = nextState.editingValue;
    if (this.#editingSession) {
      this.scheduleEditorRestore(this.#editingSession.id);
    }
    }

    private firstCellLocation(): VioletDataGridCellLocation | null {
        return resolveNavigationFirstCellLocation(
            this.presentedRows,
      this.presentedColumns,
        ) as VioletDataGridCellLocation | null;
    }

    private nextCellLocationForKey(event: KeyboardEvent): VioletDataGridCellLocation | null {
        return resolveNextCellLocationForKey({
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
            key: event.key,
            metaKey: event.ctrlKey || event.metaKey,
        }) as VioletDataGridCellLocation | null;
    }

    private setActiveCell(
        location: VioletDataGridCellLocation,
    options: { extendRange?: boolean } = {},
    ): void {
        const extendRange = options.extendRange ?? false;

        if (!this.sameEditingLocation(this.activeCell, location)) {
            this.editAnnouncement = "";
        }

        if (extendRange) {
            const anchor = this.cellSelection?.anchor ?? this.activeCell ?? location;
            this.cellSelection = this.createCellSelection(anchor, location);
        } else if (this.cellSelection) {
            this.cellSelection = null;
        }

        this.activeCell = location;
        this.updateInteractionState();
    }

    private startEditingCell(location: VioletDataGridCellLocation): void {
    if (this.editingCell) {
      if (this.sameEditingLocation(this.editingCell, location)) {
        this.refocusActiveEditor();
        return;
      }
      if (!this.commitActiveEdit()) {
        this.refocusActiveEditor();
        return;
      }
    }
        const cell = this.presentedCellAt(location);
        const nextState = beginEditingState(location, cell, cell ? this.editStringForCell(cell) : "");
        if (!nextState) {
            return;
        }

        this.cellSelection = null;
        this.editAnnouncement = "";
    this.editingError = "";
    this.#editingSession = {
      id: ++this.#nextEditingSessionId,
      location: { ...location },
    };
        this.editingValue = nextState.editingValue;
        this.editingCell = nextState.editingCell;
        this.$emit("edit-start", location);
    }

    private opensOnSingleActiveClick(editor: VioletDataGridEditor): boolean {
        return editorOpensOnSingleActiveClick(editor);
    }

  /**
   * Commit the active edit synchronously.
   *
   * Returns true only when one session resolves. False means either there
   * was no edit or validation retained the same session; inspect
   * `editingCell` before and after when the distinction matters.
   */
  public commitActiveEdit(): boolean {
    const session = this.currentEditingSession();
    if (!session || this.#resolvingEditingSessionId === session.id) {
      return false;
        }

    const cell = this.presentedCellAt(session.location);
    if (!cell?.editable || cell.editor === "checkbox") {
      return this.cancelActiveEdit();
    }

    const editor = this.getActiveEditorElement();
    if (editor) {
      this.editingValue = this.editorValueFromTarget(editor);
    }

    this.#resolvingEditingSessionId = session.id;
    const resolution = resolveEditingValue(cell, this.editingValue);
    this.#resolvingEditingSessionId = null;
    if (this.#editingSession?.id !== session.id) {
      return false;
    }
    if (!resolution.valid) {
      this.editingError = resolution.message;
      this.updateInteractionState();
      this.scheduleEditorRestore(session.id);
      return false;
    }

    const detail = {
      rowId: session.location.rowId,
      columnId: session.location.columnId,
      value: resolution.value,
    } satisfies VioletDataGridChangeDetail;
    this.clearEditingSession(session.id);
    this.$emit("cell-change", detail);
    return true;
        }

  private commitEditingCell(): boolean {
    return this.commitActiveEdit();
    }

    private commitEditingCellAndMove(direction: -1 | 1): void {
        const currentCell = this.editingCell;
        if (!currentCell) {
            return;
        }

    if (!this.commitActiveEdit()) {
      this.refocusActiveEditor();
      return;
    }

        const nextCell = this.nextTabCellLocation(currentCell, direction);
        this.setActiveCell(nextCell ?? currentCell);
        this.getScrollContainer()?.focus({ preventScroll: true });
    }

  /** Cancel the active edit synchronously and emit `edit-cancel` once. */
  public cancelActiveEdit(): boolean {
    const session = this.currentEditingSession();
    if (!session) {
      return false;
    }

    const result = clearEditingState(session.location);
    this.clearEditingSession(session.id);
    this.$emit("edit-cancel", result.cancelledCell);
    return true;
  }

    /**
     * Fills from the current cell selection, or the active cell, without dragging (WCAG 2.5.7).
     * The source extends `count` rows or columns in `direction` and the new cells are filled exactly as
     * dragging the fill handle there would: the target stops at the first strip with a read-only
     * cell, the source tiles across it, `cell-fill` is emitted with the same detail, and the filled
     * range becomes the cell selection. Consumers can call it from a row or cell menu.
     * @returns The emitted `cell-fill` detail, or `null` when nothing was filled.
     */
    public fillSelection(direction: VioletDataGridFillDirection, count = 1): VioletDataGridFillDetail | null {
        if (this.focusMode !== "cell" || this.editingCell) {
            return null;
        }

        const source = this.currentFillSourceRange();
        const sourceBounds = this.boundsForRange(source);
        const steps = Math.floor(count);
        if (!source || !sourceBounds || !(steps >= 1) || !this.hasEditableCellsInRange(source)) {
            return null;
        }

        const lastRow = this.presentedRows.length - 1;
        const lastColumn = this.presentedColumns.length - 1;
        const rowIndex =
            direction === "down"
                ? Math.min(lastRow, sourceBounds.rowEnd + steps)
                : direction === "up"
                  ? Math.max(0, sourceBounds.rowStart - steps)
                  : sourceBounds.rowEnd;
        const columnIndex =
            direction === "right"
                ? Math.min(lastColumn, sourceBounds.columnEnd + steps)
                : direction === "left"
                  ? Math.max(0, sourceBounds.columnStart - steps)
                  : sourceBounds.columnEnd;
        const location = this.locationForIndices(rowIndex, columnIndex);
        const target = location ? this.fillPreviewRangeForLocation(location, source) : null;
        if (!target) {
            return null;
        }

        const detail = this.fillDetailFor(source, target);
        if (detail) {
            this.$emit("cell-fill", detail);
        }

        this.cellSelection = this.createCellSelection(target.anchor, target.focus);
        return detail;
    }

  private currentEditingSession(): VioletDataGridEditingSession | null {
        if (!this.editingCell) {
      return null;
    }
    if (this.sameEditingLocation(this.#editingSession?.location, this.editingCell)) {
      return this.#editingSession;
    }
    this.#editingSession = {
      id: ++this.#nextEditingSessionId,
      location: { ...this.editingCell },
    };
    return this.#editingSession;
  }

  private clearEditingSession(sessionId: number): void {
    if (this.#editingSession?.id !== sessionId) {
            return;
        }
    this.#editingSession = null;
    this.#editingEditorElement = null;
    this.#pendingEditorSelection = null;
    this.#presentationRetainingSessionId = null;
    this.#resolvingEditingSessionId = null;
    this.editingCell = null;
    this.editingValue = "";
    this.editingError = "";
  }

  private sameEditingLocation(
    left: VioletDataGridCellLocation | null | undefined,
    right: VioletDataGridCellLocation | null | undefined,
  ): boolean {
    return Boolean(left && right && left.rowId === right.rowId && left.columnId === right.columnId);
  }

  private cancelEditIfSourceTargetInvalidated(): void {
    const location = this.editingCell;
    if (!location) {
      return;
    }
    const rowExists = (this.rows ?? []).some((row) => row.id === location.rowId);
    const column = (this.columns ?? []).find((column) => column.id === location.columnId);
    if (!rowExists || !column?.editable || column.editor === "checkbox") {
      this.cancelActiveEdit();
    }
  }

  private scheduleEditorRestore(sessionId: number | null, forceFocus = false, attempt = 0): void {
    if (!sessionId) {
      return;
    }
    if (this.#editorRestoreFrame !== null) {
      cancelAnimationFrame(this.#editorRestoreFrame);
    }
    this.#editorRestoreFrame = requestAnimationFrame(() => {
      this.#editorRestoreFrame = null;
      if (this.#editingSession?.id !== sessionId) {
        return;
      }
      const editor = this.getActiveEditorElement();
      if (!editor) {
        if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
          this.scheduleEditorRestore(sessionId, forceFocus, attempt + 1);
          return;
        }
        if (this.#presentationRetainingSessionId === sessionId) {
          this.cancelActiveEdit();
        }
        return;
      }
      if (editor === this.#editingEditorElement) {
        // FAST may move the same editor node while rebinding rows. Firefox
        // and WebKit drop focus on that move without replacing the element.
        if (forceFocus || this.#presentationRetainingSessionId === sessionId) {
          editor?.focus?.({ preventScroll: true });
        }
        if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
          this.scheduleEditorRestore(sessionId, forceFocus, attempt + 1);
          return;
        }
        this.#presentationRetainingSessionId = null;
        return;
      }
      seedEditorValue(editor, this.editingValue);
      this.restoreEditorSelection(editor, sessionId);
      this.#editingEditorElement = editor;
      if (this.#presentationRetainingSessionId === sessionId && attempt < 3) {
        this.scheduleEditorRestore(sessionId, true, attempt + 1);
        return;
      }
      this.#presentationRetainingSessionId = null;
    });
  }

  private captureActiveEditorSelection(): void {
    const sessionId = this.#editingSession?.id;
    const editor = this.getActiveEditorElement();
    if (sessionId && editor) {
      this.captureEditorSelection(editor, sessionId);
    }
  }

  private captureEditorSelection(editor: VioletCellEditorLike, sessionId: number): void {
    if (editor.selectionStart === null || editor.selectionStart === undefined) {
      return;
    }
    this.#pendingEditorSelection = {
      sessionId,
      start: editor.selectionStart,
      end: editor.selectionEnd ?? editor.selectionStart,
      direction: editor.selectionDirection ?? undefined,
    };
  }

  private restoreEditorSelection(editor: VioletCellEditorLike | null, sessionId: number): void {
    if (!editor) {
      return;
    }
    const selection = this.#pendingEditorSelection;
    editor.focus?.({ preventScroll: true });
    if (selection?.sessionId === sessionId && editor.setSelectionRange) {
      editor.setSelectionRange(selection.start, selection.end, selection.direction);
      this.#pendingEditorSelection = null;
      return;
    }
    focusEditorAtEnd(editor);
  }

  private refocusActiveEditor(): void {
    this.scheduleEditorRestore(this.#editingSession?.id ?? null, true);
  }

  private isTargetWithinEditingOwnership(target: EventTarget | null): boolean {
    const editor = this.getActiveEditorElement();
    if (!editor || !(target instanceof Node)) {
      return false;
    }
    if (editor.contains(target) || editor.shadowRoot?.contains(target)) {
      return true;
    }
    const element = target instanceof HTMLElement ? target : target.parentElement;
    const widget = element?.closest<HTMLElement>("[data-cell-widget]") ?? null;
    if (!widget) {
      return false;
    }
    const cell = widget.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]");
    return Boolean(
      cell &&
        this.editingCell &&
        cell.dataset.rowId === this.editingCell.rowId &&
        cell.dataset.columnId === this.editingCell.columnId,
    );
    }

    private ensureActiveCellVisible(): void {
        if (!this.activeCell) {
            return;
        }

    const rowIndex = this.#rowIndexById.get(this.activeCell.rowId);
    if (rowIndex === undefined) {
            return;
        }

        if (this.virtualize) {
            this.#rowVirtualizer.scrollToIndex(rowIndex, { align: "auto" });
        }

        requestAnimationFrame(() => {
            const activeCell = this.getActiveCellElement();
      const scrollContainer = this.getScrollContainer();
      if (!activeCell || !scrollContainer) {
        return;
      }

      const cellRect = activeCell.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      if (cellRect.left < scrollRect.left) {
        scrollContainer.scrollLeft += cellRect.left - scrollRect.left;
      } else if (cellRect.right > scrollRect.right) {
        scrollContainer.scrollLeft += cellRect.right - scrollRect.right;
      }

      if (!this.virtualize) {
        if (cellRect.top < scrollRect.top) {
          scrollContainer.scrollTop += cellRect.top - scrollRect.top;
        } else if (cellRect.bottom > scrollRect.bottom) {
          scrollContainer.scrollTop += cellRect.bottom - scrollRect.bottom;
        }
      }
        });
    }

    private cellTextAt(location: VioletDataGridCellLocation): string {
    return this.presentedCellAt(location)?.text ?? "";
    }

    private createCellSelection(
        anchor: VioletDataGridCellLocation,
    focus: VioletDataGridCellLocation,
    ): VioletDataGridCellRange | null {
        return createNavigationCellSelection(anchor, focus) as VioletDataGridCellRange | null;
    }

  private isValidCellLocation(
    location: VioletDataGridCellLocation | null,
  ): location is VioletDataGridCellLocation {
    return Boolean(
      location &&
        this.#rowIndexById.has(location.rowId) &&
        this.#columnIndexById.has(location.columnId),
    );
    }

  private normalizedCellSelection(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.boundsForRange(this.cellSelection);
    }

  private visualSelectionBounds(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.fillPreview
      ? this.boundsForRange(this.fillPreview)
      : this.normalizedCellSelection();
    }

    private selectedCellLocations(): VioletDataGridCellLocation[] {
        return selectedLocations(
            this.presentedRows,
            this.presentedColumns,
            this.normalizedCellSelection(),
      this.activeCell,
        ) as VioletDataGridCellLocation[];
    }

    private copyTextForLocations(locations: VioletDataGridCellLocation[]): string {
        return copyTextForSelection({
            selection: this.normalizedCellSelection(),
            locations,
            rows: this.presentedRows,
            columns: this.presentedColumns,
      getCellText: (location) => this.cellTextAt(location as VioletDataGridCellLocation),
        });
    }

    private copyDetailForCurrentSelection(): VioletDataGridCopyDetail | null {
        const cells = this.selectedCellLocations();

        if (!cells.length) {
            return null;
        }

        return {
            cells,
            text: this.copyTextForLocations(cells),
        };
    }

    private pasteDetailForText(text: string): VioletDataGridPasteDetail | null {
        const normalizedText = this.normalizePastedText(text);
        if (!normalizedText) {
            return null;
        }

        const origin = this.pasteOriginLocation();
        if (!origin) {
            return null;
        }

        const changes = this.pasteChangesForText(origin, normalizedText);
        if (!changes.length) {
            return null;
        }

        return {
            origin,
            text: normalizedText,
            changes,
        };
    }

    private normalizePastedText(text: string): string {
        return normalizeGridPastedText(text);
    }

    private pasteOriginLocation(): VioletDataGridCellLocation | null {
        return resolvePasteOriginLocation({
            selection: this.normalizedCellSelection(),
            rows: this.presentedRows,
            columns: this.presentedColumns,
            activeCell: this.activeCell,
        }) as VioletDataGridCellLocation | null;
    }

    private pasteChangesForText(
        origin: VioletDataGridCellLocation,
    text: string,
    ): VioletDataGridChangeDetail[] {
        const originIndices = this.cellIndicesFor(origin);
        if (!originIndices) {
            return [];
        }

        return buildPasteChanges({
            text,
            originIndices,
            selection: this.normalizedCellSelection(),
            selectedLocations: this.selectedCellLocations(),
            rows: this.presentedRows,
            columns: this.presentedColumns,
      normalizeValue: (cell, value) =>
        this.normalizedEditingValue(cell as VioletPresentedCell, value),
        }) as VioletDataGridChangeDetail[];
    }

    private currentFillSourceRange(): VioletDataGridCellRange | null {
        const selection = this.normalizedCellSelection();
        if (selection) {
            return this.rangeFromBounds(selection);
        }

        return this.activeCell ? { anchor: this.activeCell, focus: this.activeCell } : null;
    }

    private hasEditableCellsInRange(range: VioletDataGridCellRange | null): boolean {
        return hasEditableCellsInBounds(this.presentedRows, this.boundsForRange(range));
    }

    public shouldShowFillHandleForCell(rowId: string, columnId: string): boolean {
        if (this.focusMode !== "cell") {
            return false;
        }

        const range = this.currentFillSourceRange();
    if (!range) {
            return false;
        }

        const bounds = this.visualSelectionBounds() ?? this.boundsForRange(range);
        const location = bounds ? this.locationForIndices(bounds.rowEnd, bounds.columnEnd) : null;
    if (!location || location.rowId !== rowId || location.columnId !== columnId) {
      return false;
    }

    return this.hasEditableCellsInRange(range);
  }

  private currentFillSourceBounds(): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    return this.currentFillSourceRange()
      ? this.boundsForRange(this.currentFillSourceRange())
      : null;
    }

  private boundsForRange(range: VioletDataGridCellRange | null): {
              rowStart: number;
              rowEnd: number;
              columnStart: number;
              columnEnd: number;
  } | null {
    if (!range) {
      return null;
          }

    const anchor = this.cellIndicesFor(range.anchor);
    const focus = this.cellIndicesFor(range.focus);
    if (!anchor || !focus) {
      return null;
    }

    return {
      rowStart: Math.min(anchor.rowIndex, focus.rowIndex),
      rowEnd: Math.max(anchor.rowIndex, focus.rowIndex),
      columnStart: Math.min(anchor.columnIndex, focus.columnIndex),
      columnEnd: Math.max(anchor.columnIndex, focus.columnIndex),
    };
    }

    private rangeFromBounds(bounds: {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    }): VioletDataGridCellRange | null {
    return selectionRangeFromBounds(
      this.presentedRows,
      this.presentedColumns,
      bounds,
    ) as VioletDataGridCellRange | null;
    }

  private locationForIndices(
    rowIndex: number,
    columnIndex: number,
  ): VioletDataGridCellLocation | null {
        return selectionLocationForIndices(
            this.presentedRows,
            this.presentedColumns,
            rowIndex,
      columnIndex,
        ) as VioletDataGridCellLocation | null;
    }

    private beginFillDrag(event: PointerEvent): void {
        const sourceRange = this.currentFillSourceRange();
        if (!sourceRange || !this.hasEditableCellsInRange(sourceRange)) {
            return;
        }

        const session = startFillDragSession(event.pointerId, sourceRange);
        if (!session) {
            return;
        }

        const scrollContainer = this.getScrollContainer();
        this.#fillSession = session;
        this.fillPreview = null;
        scrollContainer?.focus({ preventScroll: true });
        try {
            scrollContainer?.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic Storybook pointer events do not always create a capturable pointer.
        }
        event.preventDefault();
    }

    private handleFillPointerMove(event: PointerEvent): void {
        const sourceRange = this.#fillSession.sourceRange;
        if (!sourceRange) {
            return;
        }

        const sourceBounds = this.boundsForRange(sourceRange);
        const location = this.fillTargetLocationForPoint(event.clientX, event.clientY, sourceBounds);
        this.fillPreview = location ? this.fillPreviewRangeForLocation(location, sourceRange) : null;
    }

    private handleFillPointerUp(): void {
        const detail = this.fillDetailForPreview();
        const previewRange = detail?.target ?? this.fillPreview;

        if (detail) {
            this.$emit("cell-fill", detail);
        }

        this.endFillDrag(true);

        if (!previewRange) {
            return;
        }

        this.cellSelection = this.createCellSelection(previewRange.anchor, previewRange.focus);
    }

    private endFillDrag(suppressNextClick: boolean): void {
        const scrollContainer = this.getScrollContainer();

        if (
            scrollContainer &&
            this.#fillSession.pointerId !== null &&
            scrollContainer.hasPointerCapture?.(this.#fillSession.pointerId)
        ) {
            try {
                scrollContainer.releasePointerCapture(this.#fillSession.pointerId);
            } catch {
                // Ignore release failures for synthetic pointer events.
            }
        }

        this.#suppressNextGridClick = suppressNextClick;
        this.#fillSession = clearedFillSession();
        this.fillPreview = null;
    }

    private fillPreviewRangeForLocation(
        location: VioletDataGridCellLocation,
    sourceRange: VioletDataGridCellRange,
    ): VioletDataGridCellRange | null {
        const sourceBounds = this.boundsForRange(sourceRange);
        const targetIndices = this.cellIndicesFor(location);
        if (!sourceBounds || !targetIndices) {
            return null;
        }

        const expandedBounds = {
            rowStart: Math.min(sourceBounds.rowStart, targetIndices.rowIndex),
            rowEnd: Math.max(sourceBounds.rowEnd, targetIndices.rowIndex),
            columnStart: Math.min(sourceBounds.columnStart, targetIndices.columnIndex),
            columnEnd: Math.max(sourceBounds.columnEnd, targetIndices.columnIndex),
        };
        const clampedBounds = this.clampFillBoundsToEditableTargets(expandedBounds, sourceBounds);

        if (
            clampedBounds.rowStart === sourceBounds.rowStart &&
            clampedBounds.rowEnd === sourceBounds.rowEnd &&
            clampedBounds.columnStart === sourceBounds.columnStart &&
            clampedBounds.columnEnd === sourceBounds.columnEnd
        ) {
            return null;
        }

        return this.rangeFromBounds(clampedBounds);
    }

    private clampFillBoundsToEditableTargets(
        expandedBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
        },
        sourceBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    } {
        return clampEditableFillBounds(this.presentedRows, expandedBounds, sourceBounds);
    }

    private fillTargetLocationForPoint(
        clientX: number,
        clientY: number,
    sourceBounds: {
                  rowStart: number;
                  rowEnd: number;
                  columnStart: number;
                  columnEnd: number;
    } | null,
    ): VioletDataGridCellLocation | null {
        const direct = this.locationFromPointerEventLike(clientX, clientY);
        if (direct && (!sourceBounds || !this.locationWithinBounds(direct, sourceBounds))) {
            return direct;
        }

    const preferredAxis = sourceBounds
      ? this.fillPreferredAxisForPoint(clientX, clientY, sourceBounds)
      : null;

        if (preferredAxis) {
      const axisAlignedLocation = this.nearestLocationForPoint(clientX, clientY, (location) => {
                if (sourceBounds && this.locationWithinBounds(location, sourceBounds)) {
                    return false;
                }

                const indices = this.cellIndicesFor(location);
                if (!indices || !sourceBounds) {
                    return true;
                }

                if (preferredAxis === "horizontal") {
                    return (
                        indices.rowIndex >= sourceBounds.rowStart && indices.rowIndex <= sourceBounds.rowEnd
                    );
                }

                return (
                    indices.columnIndex >= sourceBounds.columnStart &&
                    indices.columnIndex <= sourceBounds.columnEnd
                );
            });

            if (axisAlignedLocation) {
                return axisAlignedLocation;
            }
        }

    return this.nearestLocationForPoint(clientX, clientY, (location) =>
      sourceBounds ? !this.locationWithinBounds(location, sourceBounds) : true,
        );
    }

    private fillPreferredAxisForPoint(
        clientX: number,
        clientY: number,
        sourceBounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): "horizontal" | "vertical" | null {
        return preferredAxisForPoint(clientX, clientY, this.rectForBounds(sourceBounds));
    }

    private rectForBounds(bounds: {
        rowStart: number;
        rowEnd: number;
        columnStart: number;
        columnEnd: number;
    }): DOMRect | null {
        const start = this.locationForIndices(bounds.rowStart, bounds.columnStart);
        const end = this.locationForIndices(bounds.rowEnd, bounds.columnEnd);
        const startCell = this.cellElementForLocation(start);
        const endCell = this.cellElementForLocation(end);
        return rectFromCellPair(startCell, endCell);
    }

    private fillDetailForPreview(): VioletDataGridFillDetail | null {
        const source = this.#fillSession.sourceRange;
        const target = this.fillPreview;
        if (!source || !target) {
            return null;
        }

        return this.fillDetailFor(source, target);
    }

    private fillDetailFor(
        source: VioletDataGridCellRange,
        target: VioletDataGridCellRange,
    ): VioletDataGridFillDetail | null {

        const sourceBounds = this.boundsForRange(source);
        const targetBounds = this.boundsForRange(target);
        if (!sourceBounds || !targetBounds) {
            return null;
        }

        const changes = buildFillChanges({
            rows: this.presentedRows,
            columns: this.presentedColumns,
            sourceBounds,
            targetBounds,
      normalizeValue: (cell, value) =>
        this.normalizedEditingValue(cell as VioletPresentedCell, value),
        }) as VioletDataGridChangeDetail[];

        if (!changes.length) {
            return null;
        }

        return {
            source,
            target,
            changes,
        };
    }

    private presentedCellAt(location: VioletDataGridCellLocation | null): VioletPresentedCell | null {
        if (!location) {
            return null;
        }

    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    if (rowIndex === undefined || columnIndex === undefined) {
      return null;
    }

    return this.presentedRows[rowIndex]?.cells[columnIndex] ?? null;
    }

    private editStringForCell(cell: VioletPresentedCell): string {
        return editStringForRawValue(cell.rawValue);
    }

    private normalizedEditingValue(cell: VioletPresentedCell, value: unknown): unknown {
        return normalizeEditingValue(cell, value);
    }

    private booleanCellValue(value: unknown): boolean {
        return normalizeBooleanCellValue(value);
    }

    private nextTabCellLocation(
        current: VioletDataGridCellLocation,
    direction: -1 | 1,
    ): VioletDataGridCellLocation | null {
    return nextTabLocation(
      this.presentedRows,
      this.presentedColumns,
      current,
      direction,
    ) as VioletDataGridCellLocation | null;
    }

  private cellIndicesFor(
    location: VioletDataGridCellLocation,
  ): { rowIndex: number; columnIndex: number } | null {
    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    return rowIndex === undefined || columnIndex === undefined ? null : { rowIndex, columnIndex };
    }

    private isEditingCell(rowId: string, columnId: string): boolean {
        return this.editingCell?.rowId === rowId && this.editingCell?.columnId === columnId;
    }

    private isEditorElement(target: EventTarget | null): target is VioletCellEditorLike {
        return isGridEditorElement(target);
    }

    private editorValueFromTarget(target: VioletCellEditorLike): string {
        return editorStringValue(target);
    }

    private isInteractiveCellWidgetTarget(target: EventTarget | null): boolean {
        return isGridInteractiveCellWidgetTarget(target);
    }

    private commitCheckboxCellToggle(location: VioletDataGridCellLocation, checked: boolean): void {
        const cell = this.presentedCellAt(location);
        if (!cell?.editable || cell.editor !== "checkbox") {
            return;
        }

        this.$emit("cell-change", {
            rowId: location.rowId,
            columnId: location.columnId,
            value: this.normalizedEditingValue(cell, checked),
        } satisfies VioletDataGridChangeDetail);
    }

    private isFillHandleTarget(target: EventTarget | null): boolean {
        return isGridFillHandleTarget(target);
    }

    private closestFromEventPath<T extends HTMLElement>(event: Event, selector: string): T | null {
        return eventClosestFromEventPath<T>(event, selector);
    }

    private isEditorEvent(event: Event): boolean {
        return this.closestFromEventPath<HTMLElement>(event, ".cell-editor") !== null;
    }

    private isInteractiveCellWidgetEvent(event: Event): boolean {
        return event.composedPath().some((target) => isGridInteractiveCellWidgetTarget(target));
    }

    private isFillHandleEvent(event: Event): boolean {
        return this.closestFromEventPath<HTMLElement>(event, '[data-fill-handle="true"]') !== null;
    }

    public isActiveCell(rowId: string, columnId: string): boolean {
        return this.activeCell?.rowId === rowId && this.activeCell?.columnId === columnId;
    }

    private locationFromTarget(target: EventTarget | null): VioletDataGridCellLocation | null {
        const cell = this.cellElementFromTarget(target);
        return cell ? this.locationFromCellElement(cell) : null;
    }

    private locationFromEvent(event: Event): VioletDataGridCellLocation | null {
        const cell = cellElementFromEvent(event);
        return cell ? this.locationFromCellElement(cell) : null;
    }

    private cellElementFromTarget(target: EventTarget | null): HTMLTableCellElement | null {
        return eventCellElementFromTarget(target);
    }

    private locationFromPointerEvent(event: PointerEvent): VioletDataGridCellLocation | null {
        const fromPoint = this.locationFromPointerEventLike(event.clientX, event.clientY);
        if (fromPoint) {
            return fromPoint;
        }

        const fromTarget = this.locationFromTarget(event.target);
        if (fromTarget) {
            return fromTarget;
        }

        return this.nearestLocationForPoint(event.clientX, event.clientY);
    }

    private locationFromMouseEvent(event: MouseEvent): VioletDataGridCellLocation | null {
        const fromPoint = this.locationFromPointerEventLike(event.clientX, event.clientY);
        if (fromPoint) {
            return fromPoint;
        }

        return this.nearestLocationForPoint(event.clientX, event.clientY);
    }

  private locationFromPointerEventLike(
    clientX: number,
    clientY: number,
  ): VioletDataGridCellLocation | null {
        const elementAtPoint = this.shadowRoot?.elementFromPoint(clientX, clientY);
        return this.locationFromTarget(elementAtPoint ?? null);
    }

    private nearestLocationForPoint(
        clientX: number,
        clientY: number,
    predicate?: (location: VioletDataGridCellLocation) => boolean,
    ): VioletDataGridCellLocation | null {
        const cells = Array.from(
      this.shadowRoot?.querySelectorAll("td[data-row-id][data-column-id]") ?? [],
        ) as HTMLTableCellElement[];
        return nearestGeometryLocationForPoint({
            cells,
            clientX,
            clientY,
            predicate,
        }) as VioletDataGridCellLocation | null;
    }

    private locationWithinBounds(
        location: VioletDataGridCellLocation,
        bounds: {
            rowStart: number;
            rowEnd: number;
            columnStart: number;
            columnEnd: number;
    },
    ): boolean {
    const rowIndex = this.#rowIndexById.get(location.rowId);
    const columnIndex = this.#columnIndexById.get(location.columnId);
    return (
      rowIndex !== undefined &&
      columnIndex !== undefined &&
      rowIndex >= bounds.rowStart &&
      rowIndex <= bounds.rowEnd &&
      columnIndex >= bounds.columnStart &&
      columnIndex <= bounds.columnEnd
    );
    }

    private locationFromCellElement(cell: HTMLTableCellElement): VioletDataGridCellLocation | null {
        return geometryLocationFromCellElement(cell) as VioletDataGridCellLocation | null;
    }

  private cellElementForLocation(
    location: VioletDataGridCellLocation | null,
  ): HTMLTableCellElement | null {
        if (!location) {
            return null;
        }

        const rowId = CSS.escape(location.rowId);
        const columnId = CSS.escape(location.columnId);
        return this.shadowRoot?.querySelector(
      `td[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
        ) as HTMLTableCellElement | null;
    }

    private endPointerSelection(suppressNextClick: boolean): void {
        const scrollContainer = this.getScrollContainer();
        const session = this.#pointerSelectionSession;

        if (
            scrollContainer &&
            session.pointerId !== null &&
            scrollContainer.hasPointerCapture?.(session.pointerId)
        ) {
            try {
                scrollContainer.releasePointerCapture(session.pointerId);
            } catch {
                // Ignore release failures for synthetic pointer events.
            }
        }

        this.#suppressNextGridClick = pointerSelectionSuppressesNextClick(session, suppressNextClick);
        this.#pointerSelectionSession = clearedPointerSelectionSession();
    }

    public cellIdFor(rowId: string, columnId: string): string {
        return `${this.localName}-cell-${this.instanceId}-${this.sanitizeForId(rowId)}-${this.sanitizeForId(columnId)}`;
    }

  public cellEditorErrorIdFor(rowId: string, columnId: string): string {
    return `${this.cellIdFor(rowId, columnId)}-edit-error`;
  }

    private getActiveCellElement(): HTMLTableCellElement | null {
        if (!this.activeCell) {
            return null;
        }

        return this.shadowRoot?.getElementById(
      this.cellIdFor(this.activeCell.rowId, this.activeCell.columnId),
        ) as HTMLTableCellElement | null;
    }

    private getActiveEditorElement(): VioletCellEditorLike | null {
        if (!this.editingCell) {
            return null;
        }

        const rowId = CSS.escape(this.editingCell.rowId);
        const columnId = CSS.escape(this.editingCell.columnId);
        return this.shadowRoot?.querySelector(
      `.cell-editor[data-row-id="${rowId}"][data-column-id="${columnId}"]`,
        ) as VioletCellEditorLike | null;
    }

    /**
     * Encodes a row or column id into an id-safe token. Every character outside
     * [A-Za-z0-9] (including "_" and "-") becomes `_<hex>_`, so the mapping is
     * injective and a "-" delimiter between encoded parts is unambiguous.
     */
    private sanitizeForId(value: string): string {
        return Array.from(value, (character) =>
            /[a-zA-Z0-9]/.test(character) ? character : `_${character.codePointAt(0)?.toString(16)}_`,
        ).join("");
    }

    private syncHostStates(): void {
        this.toggleState("busy", this.busy);
        this.toggleState("sticky-header", this.stickyHeader);
        this.toggleState("virtualize", this.virtualize);
    this.toggleState("empty", !(this.presentedRows?.length ?? 0));
        this.#internals.ariaBusy = this.busy ? "true" : "false";
    }

  private syncRenderedRows(): void {
    if (!Array.isArray(this.presentedRows) || !Array.isArray(this.presentedColumns)) {
      return;
    }

    const focusedSelectionControl = this.focusedSelectionControl();
        const virtualItems = this.virtualize ? this.#rowVirtualizer.getVirtualItems() : [];
        const totalSize = this.virtualize ? this.#rowVirtualizer.getTotalSize() : 0;
        const nextState = computeRenderedRows({
            virtualize: this.virtualize,
            rows: this.presentedRows,
            estimatedRowHeight: this.estimatedRowHeight,
            virtualItems,
            totalSize,
        });

    const nextRowIndices = new Set(nextState.renderedRows.map((rendered) => rendered.item.index));
    const presentationRevisionBeforeRecycle = this.#presentationRevision;
    this.recycleFocusedRowIfNeeded(nextRowIndices);
    if (this.#presentationRevision !== presentationRevisionBeforeRecycle) {
      // Committing the recycled editor emits `cell-change`; a handler that replaced
      // `rows` re-entered here, so `nextState` is stale. Recompute from the new rows.
      this.syncRenderedRows();
      return;
    }

    const snapshot = this.interactionSnapshot();

    this.virtualTotalSize = totalSize;
    const canReuseRenderedRows =
      this.#renderedPresentationRevision === this.#presentationRevision &&
      this.#renderedInteractionRevision === this.#interactionRevision;
    const previousRowsByIndex = canReuseRenderedRows
      ? new Map(this.renderedRows.map((rendered) => [rendered.item.index, rendered]))
      : new Map<number, VioletRenderedRow>();
    const nextRenderedRows = nextState.renderedRows.map((rendered) => {
      const row = this.withInteractionState(
        rendered.row as VioletPresentedRow,
        rendered.item.index,
        snapshot,
      );
      const previous = previousRowsByIndex.get(rendered.item.index);
      if (previous?.row === row) {
        previous.item = rendered.item;
        return previous;
      }

      return {
        item: rendered.item,
        row,
      } satisfies VioletRenderedRow;
    });
    if (
      nextRenderedRows.length !== this.renderedRows.length ||
      nextRenderedRows.some((rendered, index) => rendered !== this.renderedRows[index])
    ) {
      this.renderedRows.splice(0, this.renderedRows.length, ...nextRenderedRows);
    }
    this.#renderedPresentationRevision = this.#presentationRevision;
    this.#renderedInteractionRevision = this.#interactionRevision;
    if (this.focusMode === "cell") {
      const renderedRowIds = new Set(nextState.renderedRows.map((rendered) => rendered.row.id));
      for (const rowId of this.#decoratedRowCache.keys()) {
        if (!renderedRowIds.has(rowId)) {
          this.#decoratedRowCache.delete(rowId);
        }
      }
    } else {
      this.#decoratedRowCache.clear();
    }
        this.virtualPaddingStart = nextState.virtualPaddingStart;
        this.virtualPaddingEnd = nextState.virtualPaddingEnd;
    this.scheduleRenderedRowMeasurement();
    this.restoreSelectionControlFocus(focusedSelectionControl);
  }

  private focusedSelectionControl(): VioletFocusedSelectionControl | null {
    const element = this.shadowRoot?.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const selector = element.matches("violet-radio.selection-radio")
      ? "violet-radio.selection-radio"
      : element.matches("violet-checkbox.selection-checkbox")
        ? "violet-checkbox.selection-checkbox"
        : null;
    const rowId = selector ? this.selectionControlRowId(element) : undefined;
    return selector && rowId
      ? { element, focusGeneration: this.#focusGeneration, rowId, selector }
      : null;
  }

  private selectionControlRowId(element: Element | null): string | undefined {
    return (
      element
        ?.closest("tr[data-row-index]")
        ?.querySelector<HTMLElement>("td[data-row-id]")
        ?.getAttribute("data-row-id") ?? undefined
    );
  }

  private restoreSelectionControlFocus(focused: VioletFocusedSelectionControl | null): void {
    if (!focused) return;
    const revision = ++this.#selectionControlFocusRevision;
    Updates.enqueue(() => {
      if (revision !== this.#selectionControlFocusRevision) return;
      if (!this.$fastController.isConnected) return;
      const shadowActive = this.shadowRoot?.activeElement;
      if (shadowActive && shadowActive !== focused.element) return;
      const documentActive = this.ownerDocument.activeElement;
      if (
        !shadowActive &&
        documentActive &&
        documentActive !== this.ownerDocument.body &&
        documentActive !== this
      )
        return;
      if (
        shadowActive === focused.element &&
        this.selectionControlRowId(shadowActive) === focused.rowId
      )
        return;
      if (this.#focusGeneration !== focused.focusGeneration) return;
      const replacement = Array.from(
        this.shadowRoot?.querySelectorAll<HTMLElement>(focused.selector) ?? [],
      ).find((control) => this.selectionControlRowId(control) === focused.rowId);
      replacement?.focus({ preventScroll: true });
    });
  }

  readonly #handleFocusIntent = (): void => {
    this.#focusGeneration += 1;
  };

  private interactionSnapshot(): VioletInteractionSnapshot {
    return {
      selectionBounds: this.visualSelectionBounds(),
      fillPreviewBounds: this.fillPreview ? this.boundsForRange(this.fillPreview) : null,
      fillSourceBounds: this.#fillSession.sourceRange
        ? this.boundsForRange(this.#fillSession.sourceRange)
        : this.currentFillSourceBounds(),
    };
  }

  private scheduleRenderedRowMeasurement(): void {
    if (!this.virtualize || !this.$fastController.isConnected) {
      return;
    }

    if (this.#rowMeasurementFrame !== null) {
      cancelAnimationFrame(this.#rowMeasurementFrame);
    }

    this.#rowMeasurementFrame = requestAnimationFrame(() => {
      this.#rowMeasurementFrame = null;
      if (!this.$fastController.isConnected) {
        return;
      }

      this.#rowVirtualizer.measureElement(null);
      const rows = this.shadowRoot?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-index]");
      rows?.forEach((row) => {
        this.#rowVirtualizer.measureElement(row);
      });
    });
  }

  private recycleFocusedRowIfNeeded(nextRowIndices: Set<number>): void {
    if (
      !this.virtualize ||
      this.#editorRecycleInProgress ||
      (nextRowIndices.size === 0 && this.presentedRows.length > 0)
    ) {
      return;
    }

    const editingRowIndex = this.editingCell
      ? this.#rowIndexById.get(this.editingCell.rowId)
      : undefined;
    const activeElement = this.shadowRoot?.activeElement as HTMLElement | null;
    const focusedRow = activeElement?.closest?.("tr[data-row-index]") as HTMLTableRowElement | null;
    const focusedRowIndex = focusedRow
      ? Number.parseInt(focusedRow.dataset.rowIndex ?? "", 10)
      : Number.NaN;
    let shouldRestoreGridFocus =
      Number.isFinite(focusedRowIndex) && !nextRowIndices.has(focusedRowIndex);

    if (editingRowIndex !== undefined && !nextRowIndices.has(editingRowIndex)) {
      this.#editorRecycleInProgress = true;
      const editingLocation = this.editingCell;
      const editingCell = editingLocation ? this.presentedCellAt(editingLocation) : null;
      const editingSessionId = this.#editingSession?.id;
      const committed = this.commitEditingCell();
      if (!committed && editingSessionId && this.#editingSession?.id === editingSessionId) {
        const columnLabel = editingCell?.columnLabel ?? editingLocation?.columnId ?? "cell";
        this.editAnnouncement = `Unsaved invalid edit in ${columnLabel} was cancelled because its row left the visible grid.`;
        this.cancelActiveEdit();
      }
      this.#editorRecycleInProgress = false;
      shouldRestoreGridFocus = true;
    }

    if (!shouldRestoreGridFocus) {
      return;
    }

    if (this.#editorRecycleFocusFrame !== null) {
      cancelAnimationFrame(this.#editorRecycleFocusFrame);
    }
    this.#editorRecycleFocusFrame = requestAnimationFrame(() => {
      this.#editorRecycleFocusFrame = null;
      if (!this.editingCell) {
        this.getScrollContainer()?.focus({ preventScroll: true });
      }
    });
    }

    private scheduleVirtualizerUpdate(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (this.#virtualizerFrame !== null) {
            cancelAnimationFrame(this.#virtualizerFrame);
        }

        this.#virtualizerFrame = requestAnimationFrame(() => {
            this.#virtualizerFrame = null;
            this.#rowVirtualizer.setOptions({
                ...this.#rowVirtualizer.options,
                ...buildVirtualizerUpdateOptions({
                    rows: this.presentedRows,
                    estimatedRowHeight: this.estimatedRowHeight,
                    overscanCount: this.overscanCount,
                    virtualize: this.virtualize,
                }),
            });
            this.#rowVirtualizer._willUpdate();
            this.#rowVirtualizer.measure();
            this.syncRenderedRows();
        });
    }

    private getScrollContainer(): HTMLDivElement | null {
        return this.shadowRoot?.querySelector(".table-scroll") as HTMLDivElement | null;
    }

  private rowHeightForDensity(density: VioletDataGridDensity): number {
    switch (density) {
      case "compact":
        return 24;
      case "comfortable":
        return 44;
      default:
        return 32;
    }
  }

    private toggleState(name: string, enabled: boolean): void {
        if (enabled) {
            this.#internals.states.add(name);
            return;
        }

        this.#internals.states.delete(name);
    }

    private mergePartNames(basePart: string, extraPart?: string): string {
        return extraPart ? `${basePart} ${extraPart}` : basePart;
    }
}

let violetDataGridInstanceCount = 0;

attr({ attribute: "selection-mode" })(VioletDataGrid.prototype, "selectionMode");
attr({ attribute: "selection-label" })(VioletDataGrid.prototype, "selectionLabel");
attr({ attribute: "sticky-header", mode: "boolean" })(VioletDataGrid.prototype, "stickyHeader");
attr({ mode: "boolean" })(VioletDataGrid.prototype, "busy");
attr({ mode: "boolean" })(VioletDataGrid.prototype, "virtualize");
attr({ attribute: "show-filter", mode: "boolean" })(VioletDataGrid.prototype, "showFilter");
attr(VioletDataGrid.prototype, "density");
attr({ attribute: "focus-mode" })(VioletDataGrid.prototype, "focusMode");
attr({ attribute: "sort-mode" })(VioletDataGrid.prototype, "sortMode");
observable(VioletDataGrid.prototype, "columns");
observable(VioletDataGrid.prototype, "columnWidths");
observable(VioletDataGrid.prototype, "rows");
observable(VioletDataGrid.prototype, "sort");
observable(VioletDataGrid.prototype, "filterState");
observable(VioletDataGrid.prototype, "selectedRowIds");
observable(VioletDataGrid.prototype, "presentedColumns");
observable(VioletDataGrid.prototype, "presentedRows");
observable(VioletDataGrid.prototype, "renderedRows");
observable(VioletDataGrid.prototype, "activeCell");
observable(VioletDataGrid.prototype, "cellSelection");
observable(VioletDataGrid.prototype, "editingCell");
observable(VioletDataGrid.prototype, "editingValue");
observable(VioletDataGrid.prototype, "editingError");
observable(VioletDataGrid.prototype, "editAnnouncement");
observable(VioletDataGrid.prototype, "fillPreview");
observable(VioletDataGrid.prototype, "estimatedRowHeight");
observable(VioletDataGrid.prototype, "overscanCount");
observable(VioletDataGrid.prototype, "virtualPaddingStart");
observable(VioletDataGrid.prototype, "virtualPaddingEnd");
observable(VioletDataGrid.prototype, "virtualTotalSize");
observable(VioletDataGrid.prototype, "hasToolbarSlotContent");
observable(VioletDataGrid.prototype, "headerFocusColumnId");

if (!customElements.get("violet-data-grid")) {
    await FASTElement.define(VioletDataGrid, {
        name: "violet-data-grid",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}

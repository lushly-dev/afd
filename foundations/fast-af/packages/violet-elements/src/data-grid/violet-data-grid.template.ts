import { html, render, repeat, when } from "@lushly-dev/fast-element";

import type { VioletDataGrid } from "./violet-data-grid";
import {
  defaultCellContentTemplate,
  inputCellEditorTemplate,
  selectCellEditorTemplate,
} from "./violet-data-grid-cell-templates";
import { columnResizeKeyShortcut } from "./violet-data-grid-resize";
import type {
  VioletPresentedCell,
  VioletPresentedColumn,
  VioletRenderedRow,
} from "./violet-data-grid-types";
import { booleanCellValue as normalizeBooleanCellValue } from "./violet-data-grid-values";

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
            part="${(x, c) =>
              c.parent.focusMode === "cell" && c.parent.isSelectionCellActive(x.row.id)
                ? "cell active-cell"
                : "cell"}"
            role="${(_x, c) =>
              c.parent.focusMode === "cell" && c.parent.selectionMode !== "none"
                ? "gridcell"
                : null}"
            aria-colindex="${(_x, c) => (c.parent.selectionMode === "none" ? null : "1")}"
            tabindex="${(x, c) => c.parent.selectionCellTabIndexFor(x.row.id)}"
            data-selection-row-id="${(x) => x.row.id}"
            data-active="${(x, c) =>
              c.parent.focusMode === "cell"
                ? String(c.parent.isSelectionCellActive(x.row.id))
                : null}"
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
                        :managedTabIndex="${(x, c) => c.parent.rowSelectionControlTabIndexFor(x.row.id)}"
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
                        tabindex="${(x, c) => String(c.parent.rowSelectionControlTabIndexFor(x.row.id))}"
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
                    role="${(_x, c) =>
                      (c.parentContext.parent as VioletDataGrid).focusMode === "cell"
                        ? "gridcell"
                        : null}"
                    aria-colindex="${(x, c) =>
                      String(
                        (c.parentContext.parent as VioletDataGrid).columnAriaColIndexFor(
                          x.columnId,
                        ),
                      )}"
                    aria-selected="${(x, c) =>
                      (c.parentContext.parent as VioletDataGrid).cellAriaSelectedFor(x)}"
                    tabindex="${(x, c) =>
                      (c.parentContext.parent as VioletDataGrid).cellTabIndexFor(
                        x.rowId,
                        x.columnId,
                      )}"
                    aria-keyshortcuts="${(_x, c) =>
                      (c.parentContext.parent as VioletDataGrid).focusMode === "cell"
                        ? columnResizeKeyShortcut
                        : null}"
                    aria-describedby="${(x, c) =>
                      (c.parentContext.parent as VioletDataGrid).cellAriaDescribedByFor(x)}"
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
                                    tabindex="${(x, c) =>
                                      String(
                                        (
                                          c.parentContext.parent as VioletDataGrid
                                        ).cellCheckboxTabIndexFor(x.rowId, x.columnId),
                                      )}"
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
                      (x) => x.editing && Boolean(x.editingHint),
                      html<VioletPresentedCell>`
                          <span class="cell-editor-hint" id="${(x) => x.editingHintId}"
                          >${(x) => x.editingHint}</span>
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
            role="${(x) => (x.focusMode === "cell" ? "grid" : null)}"
            aria-multiselectable="${(x) => (x.focusMode === "cell" ? "true" : null)}"
            aria-label="${(x) => x.hostAriaLabel}"
            aria-rowcount="${(x) => String(x.logicalRowCount)}"
            aria-colcount="${(x) => String(x.logicalColumnCount)}"
        >
        <colgroup>
            <!-- With selection off the selection cells are hidden, so the column is hidden too: a hidden <col>
                 creates no column slot, and a visible one would shift every cell one slot to the left. -->
            <col
                class="selection-column"
                ?hidden="${(x) => x.selectionMode === "none"}"
                style="width:var(--_selection-column-size);inline-size:var(--_selection-column-size);min-inline-size:var(--_selection-column-size);max-inline-size:var(--_selection-column-size);"
            />
                ${repeat(
                  (x) => x.presentedColumns,
                  html<VioletPresentedColumn>`
                    <col data-column-id="${(x) => x.id}" style="${(x) => x.widthStyle}" />
                `,
                )}
        </colgroup>
        <thead part="head">
            <tr part="header-row" aria-rowindex="1">
                <th
                    id="${(x) => x.selectionHeaderId}"
                    class="selection-header"
                    part="header-cell selection-header-cell"
                    scope="col"
                    aria-colindex="${(x) => (x.selectionMode === "none" ? null : "1")}"
                    aria-label="${(x) => x.selectionHeaderLabel}"
                    tabindex="${(x) => x.selectionHeaderCellTabIndex}"
                    ?hidden="${(x) => x.selectionMode === "none"}"
                    @keydown="${(x, c) => x.handleSelectionHeaderKeydown(c.event as KeyboardEvent)}"
                    @focusin="${(x, c) => x.handleSelectionHeaderFocus(c.event as FocusEvent)}"
                >
                    <span class="visually-hidden">${(x) => x.selectionHeaderLabel}</span>
                    ${when(
                      (x) => x.selectionMode === "multiple" && x.presentedRows.length > 0,
                      html<VioletDataGrid>`
                            <violet-checkbox
                                class="selection-checkbox"
                                inline
                                tabindex="${(x) => x.selectAllTabIndex}"
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
                            aria-colindex="${(x, c) => String(c.parent.columnAriaColIndexFor(x.id))}"
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

export const template = html<VioletDataGrid>`
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
                    ${when(
                      (x) => x.focusMode === "cell",
                      html<VioletDataGrid>`
                          <div class="fill-actions" role="group" aria-label="Fill selection">
                              <button class="fill-action" type="button"
                                  ?disabled="${(x) => !x.canFillSelection("down")}"
                                  @click="${(x) => x.handleFillAction("down")}"
                              >Fill down</button>
                              <button class="fill-action" type="button"
                                  ?disabled="${(x) => !x.canFillSelection("right")}"
                                  @click="${(x) => x.handleFillAction("right")}"
                              >Fill right</button>
                              <span class="fill-status" role="status" aria-live="polite" aria-atomic="true"
                              >${(x) => x.fillAnnouncement}</span>
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
                                tabindex="${(x) => x.scrollContainerTabIndex}"
                                @focus="${(x, c) => x.handleGridFocus(c.event as FocusEvent)}"
                                @focusin="${(x, c) => x.handleGridFocusIn(c.event as FocusEvent)}"
                                @scroll="${(x) => x.handleGridScroll()}"
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
                                        <span class="visually-hidden" id="${(x) => x.activeCellLabelId}" aria-hidden="true">
                                            ${(x) => x.activeCellDescription}
                                        </span>
                                        <span class="visually-hidden" id="${(x) => x.activeCellDescribeId}">
                                            ${(x) => x.activeCellDescribeText}
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

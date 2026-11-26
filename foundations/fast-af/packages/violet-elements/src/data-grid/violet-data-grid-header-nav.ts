import { logicalArrowKey } from "../foundations/violet-direction";
import {
  keyboardResizedColumnWidth as computeKeyboardResizedColumnWidth,
  isColumnResizeShortcut,
} from "./violet-data-grid-resize";
import { cssLengthToPixels } from "./violet-data-grid-sizing";
import type {
  VioletDataGridFocusMode,
  VioletPresentedColumn,
  VioletPresentedRow,
} from "./violet-data-grid-types";

export interface ColumnResizeKeydownHost {
  readonly element: HTMLElement;
  returnFocusFromColumnResizer(columnId: string): void;
  handleColumnResizeDoubleClick(columnId: string, event: Event): void;
  resolvedColumnWidth(columnId: string): string | undefined;
  renderedColumnWidth(columnId: string): number;
  minimumColumnWidth(columnId: string): number;
  applyLiveColumnWidth(columnId: string, width: string | undefined): void;
  commitColumnWidth(columnId: string, width: string): void;
}

export function handleColumnResizeKeyDownEvent(
  host: ColumnResizeKeydownHost,
  columnId: string,
  event: KeyboardEvent,
): boolean {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    host.returnFocusFromColumnResizer(columnId);
    return false;
  }

  if (event.key === "Tab") {
    // Resizers are not Tab stops: Tab continues from where Ctrl+Alt+R came from.
    host.returnFocusFromColumnResizer(columnId);
    return true;
  }

  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  if (event.key === "Enter") {
    host.handleColumnResizeDoubleClick(columnId, event);
    return false;
  }

  // Step from the column's own width when it is absolute: a table narrower than the grid stretches its
  // columns, so the drawn width is larger, and stepping from it would grow the column by more than a step.
  const declared = host.resolvedColumnWidth(columnId)?.trim();
  const declaredPixels =
    declared && /^\d+(\.\d+)?(px|rem)$/.test(declared) ? cssLengthToPixels(declared) : null;
  const width = computeKeyboardResizedColumnWidth({
    key: event.key,
    shiftKey: event.shiftKey,
    currentWidth: declaredPixels ?? host.renderedColumnWidth(columnId),
    minimumWidth: host.minimumColumnWidth(columnId),
    rtl: getComputedStyle(host.element).direction === "rtl",
  });

  if (width === null) {
    return true;
  }

  event.preventDefault();
  event.stopPropagation();
  host.applyLiveColumnWidth(columnId, `${width}px`);
  host.commitColumnWidth(columnId, `${width}px`);
  return false;
}

export interface HeaderKeyboardHost {
  readonly element: HTMLElement;
  readonly focusMode: VioletDataGridFocusMode;
  readonly presentedColumns: VioletPresentedColumn[];
  readonly presentedRows: VioletPresentedRow[];
  selectionHeaderFocusTarget(): HTMLElement | null;
  columnHeaderFocusTargetFor(columnId: string): HTMLElement | null;
  focusColumnResizer(columnId: string, returnTarget: HTMLElement | null): boolean;
  temporarilySuspendRovingCellTabStop(): void;
  focusActiveCell(options?: { preventScroll?: boolean }): boolean;
  setFocusedSelectionRow(rowId: string): void;
  focusFirstRowFromHeader(columnId: string, event: KeyboardEvent): boolean;
}

export function handleSelectionHeaderKeydownEvent(
  host: HeaderKeyboardHost,
  event: KeyboardEvent,
): boolean {
  const target = host.selectionHeaderFocusTarget();
  if (!target || event.target !== target) {
    return true;
  }

  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  if (event.key === "Tab") {
    if (host.focusMode !== "cell") {
      return true;
    }

    if (!event.shiftKey) {
      host.temporarilySuspendRovingCellTabStop();
      return true;
    }

    event.preventDefault();
    host.focusActiveCell({ preventScroll: true });
    return false;
  }

  if (event.shiftKey) {
    return true;
  }

  switch (logicalArrowKey(event.key, host.element)) {
    case "ArrowRight": {
      event.preventDefault();
      const firstColumnId = host.presentedColumns[0]?.id;
      if (firstColumnId) {
        host.columnHeaderFocusTargetFor(firstColumnId)?.focus();
      }
      return false;
    }
    case "ArrowLeft":
    case "Home":
      event.preventDefault();
      return false;
    case "End": {
      event.preventDefault();
      const lastColumnId = host.presentedColumns.at(-1)?.id;
      if (lastColumnId) {
        host.columnHeaderFocusTargetFor(lastColumnId)?.focus();
      }
      return false;
    }
    case "ArrowDown": {
      const firstRowId = host.presentedRows[0]?.id;
      if (host.focusMode !== "cell" || !firstRowId) {
        return true;
      }
      event.preventDefault();
      host.setFocusedSelectionRow(firstRowId);
      host.focusActiveCell({ preventScroll: true });
      return false;
    }
    default:
      return true;
  }
}

export function handleColumnHeaderKeydownEvent(
  host: HeaderKeyboardHost,
  columnId: string,
  event: KeyboardEvent,
): boolean {
  const header = host.columnHeaderFocusTargetFor(columnId);
  // Keys pressed on the column's resizer bubble through the header cell.
  if (!header || event.target !== header) {
    return true;
  }

  if (isColumnResizeShortcut(event)) {
    event.preventDefault();
    return !host.focusColumnResizer(columnId, header);
  }

  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  if (event.key === "Tab") {
    if (host.focusMode !== "cell") {
      return true;
    }

    if (!event.shiftKey) {
      // Skip the body's roving td[tabindex="0"] so forward Tab leaves the grid.
      host.temporarilySuspendRovingCellTabStop();
      return true;
    }

    // The header sits above the body within the grid's single Tab stop.
    event.preventDefault();
    host.focusActiveCell({ preventScroll: true });
    return false;
  }

  if (event.shiftKey) {
    return true;
  }

  const columns = host.presentedColumns;
  const columnIndex = columns.findIndex((column) => column.id === columnId);
  let nextColumnId: string | undefined;

  switch (logicalArrowKey(event.key, host.element)) {
    case "ArrowLeft":
      if (columnIndex === 0) {
        const selectionHeader = host.selectionHeaderFocusTarget();
        if (selectionHeader) {
          event.preventDefault();
          selectionHeader.focus();
          return false;
        }
      }
      nextColumnId = columns[Math.max(0, columnIndex - 1)]?.id;
      break;
    case "ArrowRight":
      nextColumnId = columns[Math.min(columns.length - 1, columnIndex + 1)]?.id;
      break;
    case "Home": {
      const selectionHeader = host.selectionHeaderFocusTarget();
      if (selectionHeader) {
        event.preventDefault();
        selectionHeader.focus();
        return false;
      }
      nextColumnId = columns[0]?.id;
      break;
    }
    case "End":
      nextColumnId = columns.at(-1)?.id;
      break;
    case "ArrowDown":
      return host.focusFirstRowFromHeader(columnId, event);
    default:
      return true;
  }

  event.preventDefault();
  if (nextColumnId) {
    host.columnHeaderFocusTargetFor(nextColumnId)?.focus();
  }
  return false;
}

import { logicalArrowKey } from "../foundations/violet-direction";
import { customCellWidgetSelector } from "./violet-data-grid-targets";
import type {
  VioletDataGridCellLocation,
  VioletDataGridFocusMode,
  VioletPresentedColumn,
  VioletPresentedRow,
} from "./violet-data-grid-types";

export interface SelectionCellKeydownHost {
  readonly element: HTMLElement;
  readonly focusedSelectionRowId: string | null;
  readonly presentedRows: VioletPresentedRow[];
  readonly presentedColumns: VioletPresentedColumn[];
  rowIndexForId(rowId: string): number | undefined;
  toggleRowSelectionFromKeyboard(rowId: string): void;
  selectionHeaderFocusTarget(): HTMLElement | null;
  columnHeaderFocusTargetFor(columnId: string): HTMLElement | null;
  setFocusedSelectionRow(rowId: string): void;
  setActiveCell(location: VioletDataGridCellLocation): void;
  focusActiveCell(options?: { preventScroll?: boolean }): boolean;
}

export interface RowModeBodyKeydownHost {
  readonly element: HTMLElement;
  readonly presentedRows: VioletPresentedRow[];
  rowModeInteractiveColumns(): Array<string | null>;
  selectionControlRowId(element: Element | null): string | undefined;
  rowIndexForId(rowId: string): number | undefined;
  setRowModeFocusTarget(rowId: string, columnId: string | null, rowIndex: number): void;
}

export interface CustomCellWidgetHost {
  setActiveCell(location: VioletDataGridCellLocation): void;
  focusActiveCell(options?: { preventScroll?: boolean }): boolean;
  temporarilySuspendRovingCellTabStop(): void;
}

export function handleSelectionCellKeydownEvent(
  host: SelectionCellKeydownHost,
  event: KeyboardEvent,
  target: HTMLElement | null,
  moveDomFocus: boolean,
): boolean {
  const rowId =
    (target instanceof HTMLTableCellElement ? target.dataset.selectionRowId : undefined) ??
    host.focusedSelectionRowId ??
    host.presentedRows[0]?.id;
  if (!rowId) {
    return true;
  }

  const rowIndex = host.rowIndexForId(rowId);
  if (rowIndex === undefined) {
    return true;
  }

  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    host.toggleRowSelectionFromKeyboard(rowId);
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return true;
  }

  const lastRowIndex = host.presentedRows.length - 1;
  const firstColumnId = host.presentedColumns[0]?.id;
  const lastColumnId = host.presentedColumns.at(-1)?.id;
  const logicalKey = logicalArrowKey(event.key, host.element);

  switch (logicalKey) {
    case "ArrowUp": {
      if (event.ctrlKey || event.metaKey) {
        return true;
      }
      event.preventDefault();
      if (rowIndex === 0) {
        const header =
          host.selectionHeaderFocusTarget() ??
          (firstColumnId ? host.columnHeaderFocusTargetFor(firstColumnId) : null);
        header?.focus();
        return false;
      }
      const prevRowId = host.presentedRows[rowIndex - 1]?.id;
      if (prevRowId) {
        host.setFocusedSelectionRow(prevRowId);
        if (moveDomFocus) {
          host.focusActiveCell({ preventScroll: true });
        }
      }
      return false;
    }
    case "ArrowDown": {
      if (event.ctrlKey || event.metaKey) {
        return true;
      }
      event.preventDefault();
      const nextRowId = host.presentedRows[Math.min(lastRowIndex, rowIndex + 1)]?.id;
      if (nextRowId) {
        host.setFocusedSelectionRow(nextRowId);
        if (moveDomFocus) {
          host.focusActiveCell({ preventScroll: true });
        }
      }
      return false;
    }
    case "ArrowRight": {
      if (event.ctrlKey || event.metaKey || !firstColumnId) {
        return true;
      }
      event.preventDefault();
      host.setActiveCell({ rowId, columnId: firstColumnId });
      if (moveDomFocus) {
        host.focusActiveCell({ preventScroll: true });
      }
      return false;
    }
    case "ArrowLeft":
      if (event.ctrlKey || event.metaKey) {
        return true;
      }
      event.preventDefault();
      return false;
    case "Home": {
      event.preventDefault();
      const targetRowId =
        event.ctrlKey || event.metaKey ? (host.presentedRows[0]?.id ?? rowId) : rowId;
      host.setFocusedSelectionRow(targetRowId);
      if (moveDomFocus) {
        host.focusActiveCell({ preventScroll: true });
      }
      return false;
    }
    case "End": {
      if (!lastColumnId) {
        return true;
      }
      event.preventDefault();
      const targetRowId =
        event.ctrlKey || event.metaKey ? (host.presentedRows[lastRowIndex]?.id ?? rowId) : rowId;
      host.setActiveCell({ rowId: targetRowId, columnId: lastColumnId });
      if (moveDomFocus) {
        host.focusActiveCell({ preventScroll: true });
      }
      return false;
    }
    default:
      return true;
  }
}

export function handleRowModeBodyKeydownEvent(
  host: RowModeBodyKeydownHost,
  event: KeyboardEvent,
): boolean {
  if (event.altKey || event.shiftKey) {
    return true;
  }

  const target = event.target as HTMLElement | null;
  if (!target) {
    return true;
  }

  const isSelectionControl =
    target.matches("violet-radio.selection-radio, violet-checkbox.selection-checkbox") &&
    target.closest("tbody") !== null;
  const isCellCheckbox = target.matches("violet-checkbox.cell-checkbox");
  if (!isSelectionControl && !isCellCheckbox) {
    return true;
  }

  const columns = host.rowModeInteractiveColumns();
  if (columns.length === 0 || host.presentedRows.length === 0) {
    return true;
  }

  const currentRowId = isSelectionControl
    ? host.selectionControlRowId(target)
    : target.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]")?.dataset.rowId;
  const currentColumnId = isSelectionControl
    ? null
    : (target.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]")?.dataset.columnId ??
      null);
  if (!currentRowId) {
    return true;
  }

  const rowIndex = host.rowIndexForId(currentRowId);
  const colIndex = columns.indexOf(currentColumnId);
  if (rowIndex === undefined || colIndex < 0) {
    return true;
  }

  const lastRowIndex = host.presentedRows.length - 1;
  const lastColIndex = columns.length - 1;
  let nextRowIndex = rowIndex;
  let nextColIndex = colIndex;

  switch (logicalArrowKey(event.key, host.element)) {
    case "ArrowUp":
      if (event.ctrlKey || event.metaKey) return true;
      nextRowIndex = Math.max(0, rowIndex - 1);
      break;
    case "ArrowDown":
      if (event.ctrlKey || event.metaKey) return true;
      nextRowIndex = Math.min(lastRowIndex, rowIndex + 1);
      break;
    case "ArrowLeft":
      if (event.ctrlKey || event.metaKey) return true;
      nextColIndex = Math.max(0, colIndex - 1);
      break;
    case "ArrowRight":
      if (event.ctrlKey || event.metaKey) return true;
      nextColIndex = Math.min(lastColIndex, colIndex + 1);
      break;
    case "Home":
      if (event.ctrlKey || event.metaKey) {
        nextRowIndex = 0;
      }
      nextColIndex = 0;
      break;
    case "End":
      if (event.ctrlKey || event.metaKey) {
        nextRowIndex = lastRowIndex;
      }
      nextColIndex = lastColIndex;
      break;
    default:
      return true;
  }

  const nextRowId = host.presentedRows[nextRowIndex]?.id;
  const nextColumnId = columns[nextColIndex];
  if (!nextRowId || nextColumnId === undefined) {
    return true;
  }

  event.preventDefault();
  host.setRowModeFocusTarget(nextRowId, nextColumnId, nextRowIndex);
  return false;
}

export function focusRowModeControlInShadow(
  shadowRoot: ShadowRoot | null,
  rowId: string,
  columnId: string | null,
  options: { preventScroll?: boolean } = {},
): boolean {
  const preventScroll = options.preventScroll ?? true;
  const escapedRow = CSS.escape(rowId);
  if (columnId === null) {
    const cell = shadowRoot?.querySelector<HTMLTableCellElement>(
      `td.selection-cell[data-selection-row-id="${escapedRow}"]`,
    );
    const control = cell?.querySelector<HTMLElement>(
      "violet-radio.selection-radio, violet-checkbox.selection-checkbox",
    );
    if (!control) {
      return false;
    }
    control.focus({ preventScroll });
    return true;
  }

  const escapedCol = CSS.escape(columnId);
  const checkbox = shadowRoot?.querySelector<HTMLElement>(
    `td[data-row-id="${escapedRow}"][data-column-id="${escapedCol}"] violet-checkbox.cell-checkbox`,
  );
  if (!checkbox) {
    return false;
  }
  checkbox.focus({ preventScroll });
  return true;
}

export function customCellWidgetsInCellElement(cell: HTMLTableCellElement): HTMLElement[] {
  return Array.from(cell.querySelectorAll<HTMLElement>(customCellWidgetSelector)).filter(
    (element) =>
      !element.classList.contains("cell-editor") &&
      !element.classList.contains("cell-checkbox") &&
      !(element as HTMLButtonElement).disabled &&
      element.getAttribute("aria-disabled") !== "true",
  );
}

export function findCustomCellWidgetFromTarget(target: HTMLElement | null): HTMLElement | null {
  if (!target) {
    return null;
  }
  const hostCell = target.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]");
  if (!hostCell) {
    return null;
  }
  const widget = target.closest<HTMLElement>(customCellWidgetSelector);
  if (
    !widget ||
    !hostCell.contains(widget) ||
    widget.classList.contains("cell-editor") ||
    widget.classList.contains("cell-checkbox")
  ) {
    return null;
  }
  return widget;
}

export function handleCustomCellWidgetKeydownEvent(
  host: CustomCellWidgetHost,
  widget: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const hostCell = widget.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]");
  if (event.key === "Escape") {
    event.preventDefault();
    if (hostCell?.dataset.rowId && hostCell.dataset.columnId) {
      host.setActiveCell({
        rowId: hostCell.dataset.rowId,
        columnId: hostCell.dataset.columnId,
      });
    }
    host.focusActiveCell({ preventScroll: true });
    return false;
  }

  if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const widgets = hostCell ? customCellWidgetsInCellElement(hostCell) : [];
    const index = widgets.indexOf(widget);
    if (event.shiftKey) {
      if (index > 0) {
        event.preventDefault();
        widgets[index - 1]?.focus({ preventScroll: true });
        return false;
      }
      host.temporarilySuspendRovingCellTabStop();
      return true;
    }
    if (index >= 0 && index < widgets.length - 1) {
      event.preventDefault();
      widgets[index + 1]?.focus({ preventScroll: true });
      return false;
    }
    host.temporarilySuspendRovingCellTabStop();
    return true;
  }

  return true;
}

export function syncCustomCellWidgetTabIndexesInShadow(
  shadowRoot: ShadowRoot | null,
  focusMode: VioletDataGridFocusMode,
  managed: WeakMap<HTMLElement, string | null>,
): void {
  const cells = shadowRoot?.querySelectorAll<HTMLTableCellElement>(
    "tbody td[data-row-id][data-column-id]",
  );
  if (!cells) {
    return;
  }
  for (const cell of cells) {
    const widgets = cell.querySelectorAll<HTMLElement>(customCellWidgetSelector);
    for (const widget of widgets) {
      if (widget.classList.contains("cell-editor") || widget.classList.contains("cell-checkbox")) {
        continue;
      }
      if (focusMode === "cell") {
        if (!managed.has(widget)) {
          managed.set(widget, widget.getAttribute("tabindex"));
        }
        if (widget.getAttribute("tabindex") !== "-1") {
          widget.setAttribute("tabindex", "-1");
        }
      } else if (managed.has(widget)) {
        const original = managed.get(widget);
        managed.delete(widget);
        if (original === null || original === undefined) {
          widget.removeAttribute("tabindex");
        } else {
          widget.setAttribute("tabindex", original);
        }
      }
    }
  }
}

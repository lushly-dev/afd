import { logicalArrowKey } from "../foundations/violet-direction";
import { isColumnResizeShortcut } from "./violet-data-grid-resize";
import type {
  VioletDataGridCellLocation,
  VioletDataGridFocusMode,
  VioletDataGridSelectionMode,
  VioletPresentedCell,
  VioletPresentedRow,
} from "./violet-data-grid-types";

export interface GridFocusInHost {
  readonly focusMode: VioletDataGridFocusMode;
  readonly editingCell: VioletDataGridCellLocation | null;
  readonly activeCell: VioletDataGridCellLocation | null;
  focusedSelectionRowId: string | null;
  rowModeFocusRowId: string | null;
  rowModeFocusColumnId: string | null;
  setActiveCellDirect(location: VioletDataGridCellLocation): void;
  setFocusedSelectionRow(rowId: string): void;
  sameEditingLocation(
    left: VioletDataGridCellLocation | null,
    right: VioletDataGridCellLocation | null,
  ): boolean;
  selectionControlRowId(element: Element | null): string | undefined;
}

export interface GridKeydownHost {
  readonly element: HTMLElement;
  readonly focusMode: VioletDataGridFocusMode;
  readonly selectionMode: VioletDataGridSelectionMode;
  readonly activeCell: VioletDataGridCellLocation | null;
  readonly focusedSelectionRowId: string | null;
  readonly presentedRows: VioletPresentedRow[];
  readonly shadowActiveElement: Element | null;
  handleRowModeBodyKeydown(event: KeyboardEvent): boolean;
  isEditorElement(target: EventTarget | null): boolean;
  commitActiveEdit(): boolean;
  focusActiveCell(options?: { preventScroll?: boolean }): boolean;
  refocusActiveEditor(): void;
  commitEditingCellAndMove(step: -1 | 1): void;
  cancelActiveEdit(): void;
  customCellWidgetFromTarget(target: HTMLElement | null): HTMLElement | null;
  handleCustomCellWidgetKeydown(widget: HTMLElement, event: KeyboardEvent): boolean;
  getScrollContainer(): HTMLDivElement | null;
  handleSelectionCellKeydown(
    event: KeyboardEvent,
    target: HTMLElement | null,
    moveDomFocus: boolean,
  ): boolean;
  focusColumnResizer(columnId: string, returnTarget: HTMLElement | null): boolean;
  getActiveGridCellElement(): HTMLTableCellElement | null;
  scheduleNativeCopyFallback(): void;
  presentedCellAt(location: VioletDataGridCellLocation): VioletPresentedCell | null;
  booleanCellValue(value: unknown): boolean;
  commitCheckboxCellToggle(location: VioletDataGridCellLocation, checked: boolean): void;
  getActiveCellElement(): HTMLTableCellElement | null;
  customCellWidgetsInCell(cell: HTMLTableCellElement): HTMLElement[];
  startEditingCell(location: VioletDataGridCellLocation): void;
  columnHeaderFocusTargetFor(columnId: string): HTMLElement | null;
  columnIndexForId(columnId: string): number;
  setFocusedSelectionRow(rowId: string): void;
  nextCellLocationForKey(event: KeyboardEvent, key?: string): VioletDataGridCellLocation | null;
  setActiveCell(location: VioletDataGridCellLocation, options?: { extendRange?: boolean }): void;
}

export function handleGridFocusInEvent(host: GridFocusInHost, event: FocusEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  if (host.focusMode === "cell") {
    if (host.editingCell) {
      return;
    }
    if (target instanceof HTMLTableCellElement && target.classList.contains("selection-cell")) {
      const rowId = target.dataset.selectionRowId;
      if (rowId && host.focusedSelectionRowId !== rowId) {
        host.setFocusedSelectionRow(rowId);
      }
      return;
    }

    if (target instanceof HTMLTableCellElement && target.dataset.rowId && target.dataset.columnId) {
      const location = {
        rowId: target.dataset.rowId,
        columnId: target.dataset.columnId,
      };
      if (
        host.focusedSelectionRowId !== null ||
        !host.sameEditingLocation(host.activeCell, location)
      ) {
        host.focusedSelectionRowId = null;
        host.setActiveCellDirect(location);
      }
    }
    return;
  }

  if (target.matches("violet-radio.selection-radio, violet-checkbox.selection-checkbox")) {
    const rowId = host.selectionControlRowId(target);
    if (rowId) {
      host.rowModeFocusRowId = rowId;
      host.rowModeFocusColumnId = null;
    }
    return;
  }

  if (target.matches("violet-checkbox.cell-checkbox")) {
    const cell = target.closest<HTMLTableCellElement>("td[data-row-id][data-column-id]");
    if (cell?.dataset.rowId && cell.dataset.columnId) {
      host.rowModeFocusRowId = cell.dataset.rowId;
      host.rowModeFocusColumnId = cell.dataset.columnId;
    }
  }
}

export function handleGridKeydownEvent(host: GridKeydownHost, event: KeyboardEvent): boolean {
  if (host.focusMode !== "cell") {
    return host.handleRowModeBodyKeydown(event);
  }

  if (event.isComposing || event.keyCode === 229) {
    return true;
  }

  const target = event.target as HTMLElement | null;

  if (host.isEditorElement(target)) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (host.commitActiveEdit()) {
        host.focusActiveCell({ preventScroll: true });
      } else {
        host.refocusActiveEditor();
      }
      return false;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      host.commitEditingCellAndMove(event.shiftKey ? -1 : 1);
      return false;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      host.cancelActiveEdit();
      host.focusActiveCell({ preventScroll: true });
      return false;
    }

    return true;
  }

  const customWidget = host.customCellWidgetFromTarget(target);
  if (customWidget) {
    return host.handleCustomCellWidgetKeydown(customWidget, event);
  }

  const scrollContainer = host.getScrollContainer();
  const isSelectionCellTarget =
    target instanceof HTMLTableCellElement && target.classList.contains("selection-cell");
  const isDataCellTarget =
    target instanceof HTMLTableCellElement &&
    Boolean(target.dataset.rowId && target.dataset.columnId);

  if (target && target !== scrollContainer && !isDataCellTarget && !isSelectionCellTarget) {
    return true;
  }

  const moveDomFocus =
    isDataCellTarget || isSelectionCellTarget || host.shadowActiveElement === scrollContainer;

  if (isSelectionCellTarget || (target === scrollContainer && host.focusedSelectionRowId)) {
    return host.handleSelectionCellKeydown(event, target, moveDomFocus);
  }

  if (isColumnResizeShortcut(event) && host.activeCell) {
    event.preventDefault();
    return !host.focusColumnResizer(
      host.activeCell.columnId,
      host.getActiveGridCellElement() ?? scrollContainer,
    );
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "c"
  ) {
    host.scheduleNativeCopyFallback();
    return true;
  }

  if ((event.key === " " || event.key === "Spacebar" || event.key === "Enter") && host.activeCell) {
    const activeCell = host.presentedCellAt(host.activeCell);
    if (activeCell?.editable && activeCell.editor === "checkbox") {
      event.preventDefault();
      host.commitCheckboxCellToggle(host.activeCell, !host.booleanCellValue(activeCell.rawValue));
      return false;
    }
  }

  if ((event.key === "Enter" || event.key === "F2") && host.activeCell) {
    if (event.key === "Enter") {
      const activeCellElement = host.getActiveCellElement();
      const customWidgets = activeCellElement
        ? host.customCellWidgetsInCell(activeCellElement)
        : [];
      if (customWidgets.length > 0) {
        event.preventDefault();
        customWidgets[0]?.focus({ preventScroll: true });
        return false;
      }
    }

    const editableCell = host.presentedCellAt(host.activeCell);
    if (!editableCell?.editable) {
      return true;
    }

    event.preventDefault();
    host.startEditingCell(host.activeCell);
    return false;
  }

  const logicalKey = logicalArrowKey(event.key, host.element);

  if (
    logicalKey === "ArrowUp" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    host.activeCell &&
    host.activeCell.rowId === host.presentedRows[0]?.id
  ) {
    const header = host.columnHeaderFocusTargetFor(host.activeCell.columnId);
    if (header) {
      event.preventDefault();
      header.focus();
      return false;
    }
  }

  if (host.selectionMode !== "none" && !event.shiftKey && !event.altKey && host.activeCell) {
    const activeColumnIndex = host.columnIndexForId(host.activeCell.columnId);
    if (logicalKey === "ArrowLeft" && !event.ctrlKey && !event.metaKey && activeColumnIndex === 0) {
      event.preventDefault();
      host.setFocusedSelectionRow(host.activeCell.rowId);
      if (moveDomFocus) {
        host.focusActiveCell({ preventScroll: true });
      }
      return false;
    }
  }

  const nextLocation = host.nextCellLocationForKey(event, logicalKey);
  if (!nextLocation) {
    return true;
  }

  event.preventDefault();
  host.setActiveCell(nextLocation, { extendRange: event.shiftKey });
  if (moveDomFocus) {
    host.focusActiveCell({ preventScroll: true });
  }
  return false;
}

export interface GridClickHost {
  readonly focusMode: VioletDataGridFocusMode;
  readonly editingCell: VioletDataGridCellLocation | null;
  readonly activeCell: VioletDataGridCellLocation | null;
  suppressNextGridClick: boolean;
  lastCellClickLocation: VioletDataGridCellLocation | null;
  lastCellClickTimestamp: number;
  isEditorEvent(event: Event): boolean;
  isEditorElement(target: EventTarget | null): boolean;
  isInteractiveCellWidgetEvent(event: Event): boolean;
  isInteractiveCellWidgetTarget(target: EventTarget | null): boolean;
  commitActiveEdit(): boolean;
  refocusActiveEditor(): void;
  setFocusedSelectionRow(rowId: string): void;
  focusActiveCell(options?: { preventScroll?: boolean }): boolean;
  locationFromMouseEvent(event: MouseEvent): VioletDataGridCellLocation | null;
  locationFromEvent(event: Event): VioletDataGridCellLocation | null;
  locationFromTarget(target: EventTarget | null): VioletDataGridCellLocation | null;
  presentedCellAt(location: VioletDataGridCellLocation): VioletPresentedCell | null;
  startEditingCell(location: VioletDataGridCellLocation): void;
  sameEditingLocation(
    left: VioletDataGridCellLocation | null,
    right: VioletDataGridCellLocation | null,
  ): boolean;
  opensOnSingleActiveClick(editor: VioletPresentedCell["editor"]): boolean;
  handleCellPointerActivate(rowId: string, columnId: string, shiftKey: boolean): void;
}

export function handleGridClickEvent(host: GridClickHost, event: Event): boolean {
  if (host.focusMode !== "cell") {
    return true;
  }

  if (host.suppressNextGridClick) {
    host.suppressNextGridClick = false;
    return true;
  }

  const target = event.target as HTMLElement | null;
  if (
    host.isEditorEvent(event) ||
    host.isEditorElement(target) ||
    host.isInteractiveCellWidgetEvent(event) ||
    host.isInteractiveCellWidgetTarget(target)
  ) {
    return true;
  }

  const pointerEvent = event as MouseEvent;
  const selectionCell =
    target instanceof Element
      ? target.closest<HTMLTableCellElement>("td.selection-cell[data-selection-row-id]")
      : null;
  if (selectionCell?.dataset.selectionRowId) {
    if (host.editingCell && !host.commitActiveEdit()) {
      host.refocusActiveEditor();
      return true;
    }
    host.setFocusedSelectionRow(selectionCell.dataset.selectionRowId);
    host.focusActiveCell({ preventScroll: true });
    return true;
  }

  const location =
    host.locationFromMouseEvent(pointerEvent) ??
    host.locationFromEvent(event) ??
    host.locationFromTarget(target);
  if (!location) {
    if (pointerEvent.detail >= 2 && host.activeCell) {
      const activeCell = host.presentedCellAt(host.activeCell);
      if (activeCell?.editable && activeCell.editor !== "checkbox") {
        host.startEditingCell(host.activeCell);
      }
    }
    return true;
  }

  if (
    host.editingCell &&
    !host.sameEditingLocation(host.editingCell, location) &&
    !host.commitActiveEdit()
  ) {
    host.refocusActiveEditor();
    return true;
  }

  const sameActiveCell =
    host.activeCell?.rowId === location.rowId && host.activeCell?.columnId === location.columnId;
  const activeCell = host.presentedCellAt(location);

  if (sameActiveCell && activeCell?.editable && host.opensOnSingleActiveClick(activeCell.editor)) {
    host.startEditingCell(location);
    return true;
  }

  host.handleCellPointerActivate(location.rowId, location.columnId, pointerEvent.shiftKey);

  const timestamp =
    typeof pointerEvent.timeStamp === "number" ? pointerEvent.timeStamp : performance.now();
  const sameCellAsLastClick =
    host.lastCellClickLocation?.rowId === location.rowId &&
    host.lastCellClickLocation?.columnId === location.columnId;
  const withinDoubleClickWindow = timestamp - host.lastCellClickTimestamp <= 350;

  if (pointerEvent.detail >= 2 || (sameCellAsLastClick && withinDoubleClickWindow)) {
    const cell = host.presentedCellAt(location);
    if (cell?.editable && cell.editor !== "checkbox") {
      host.startEditingCell(location);
    }
  }

  host.lastCellClickLocation = location;
  host.lastCellClickTimestamp = timestamp;
  return true;
}

import type { ContentTemplate } from "@lushly-dev/fast-element";
import type { VirtualItem } from "@tanstack/virtual-core";

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
  /** The column's `editorHint` for this row while the cell is edited; empty while an error shows. */
  editingHint?: string;
  /** Id of the rendered hint, for a custom editor's `aria-describedby`. */
  editingHintId?: string;
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
  /**
   * Text shown inside this column's open cell editor and linked to the editor as its description,
   * such as what an edit will change. Return nothing for no hint. An edit error replaces it while
   * the error shows.
   */
  editorHint?: (row: RowData) => string | undefined;
  /**
   * A per-cell fact appended to the cell-mode active-cell description for assistive technology.
   * It never enters the serialized value that copy, paste and autosize read.
   */
  describe?: (row: RowData) => string | undefined;
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

export interface VioletPresentedColumn<RowData = unknown> {
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

export interface VioletPresentedCell {
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
  editingHint?: string;
  editingHintId?: string;
  fillPreview: boolean;
  cellPart?: string;
  cellPartText: string;
  resolvedCellPartText: string;
  cellTemplate?: VioletDataGridCellTemplate<unknown>;
  editorTemplate?: VioletDataGridCellEditorTemplate<unknown>;
  editorOptions: VioletDataGridEditorOption[];
  parse?: (value: unknown, row: unknown) => unknown;
}

export interface VioletPresentedRow<RowData = unknown> {
  id: string;
  label: string;
  data: RowData;
  cells: VioletPresentedCell[];
}

export interface VioletRenderedRow {
  item: VirtualItem;
  row: VioletPresentedRow;
}

export interface VioletFocusedSelectionControl {
  element: HTMLElement;
  focusGeneration: number;
  rowId: string;
  selector: "violet-radio.selection-radio" | "violet-checkbox.selection-checkbox";
}

export interface VioletDataGridBounds {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

export interface VioletInteractionSnapshot {
  selectionBounds: VioletDataGridBounds | null;
  fillPreviewBounds: VioletDataGridBounds | null;
  fillSourceBounds: VioletDataGridBounds | null;
}

export interface VioletDataGridEditingSession {
  id: number;
  location: VioletDataGridCellLocation;
}

export type VioletTextFieldLike = EventTarget & {
  value?: string;
};

export type VioletCheckboxLike = EventTarget & {
  checked?: boolean;
  indeterminate?: boolean;
};

export type VioletCellEditorLike = HTMLElement & {
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

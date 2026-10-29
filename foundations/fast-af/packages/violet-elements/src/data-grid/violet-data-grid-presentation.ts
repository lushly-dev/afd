import type { ContentTemplate } from "@lushly-dev/fast-element";
import { safeCssValue } from "./violet-data-grid-css";
import { firstCellLocation as resolveFirstCellLocation } from "./violet-data-grid-navigation";

export interface VioletPresentationIdLike {
    id: string;
}

export interface VioletPresentationLocationLike {
    rowId: string;
    columnId: string;
}

export interface VioletPresentationRangeLike<
    LocationLike extends VioletPresentationLocationLike = VioletPresentationLocationLike,
> {
    anchor: LocationLike;
    focus: LocationLike;
}

export interface VioletPresentationCellLike {
    rowId: string;
    columnId: string;
    cellPartText: string;
    active: boolean;
    selected: boolean;
    fillPreview: boolean;
    rangeEdge: string;
    editing: boolean;
    editValue: string;
  editingError: string;
  editingErrorId: string;
    resolvedCellPartText: string;
}

export interface VioletPresentationRowLike<
  CellLike extends VioletPresentationCellLike = VioletPresentationCellLike,
> {
    cells: CellLike[];
}

export interface VioletPresentationSourceColumnLike<RowData = unknown> {
    id: string;
    label: string;
    sortable?: boolean;
    width?: string;
    align?: "start" | "center" | "end";
    headerPart?: string;
    cellPart?: string;
    editable?: boolean;
    editor?: "text" | "number" | "checkbox" | "select" | "custom";
    cellTemplate?: ContentTemplate;
    editorTemplate?: ContentTemplate;
    parse?: (value: unknown, row: RowData) => unknown;
}

export interface VioletPresentationColumnLike<RowData = unknown> {
    id: string;
    label: string;
    sortable: boolean;
    width?: string;
    widthStyle: string;
    align: "start" | "center" | "end";
    headerPart?: string;
    headerPartText: string;
    cellPart?: string;
    cellPartText: string;
    source: VioletPresentationSourceColumnLike<RowData>;
}

export interface VioletPresentationSourceRowLike<RowData = unknown> {
    id: string;
    label?: string;
    data: RowData;
}

export function isValidCellLocation(
    rows: VioletPresentationIdLike[],
    columns: VioletPresentationIdLike[],
  location: VioletPresentationLocationLike | null,
): location is VioletPresentationLocationLike {
    if (!location) {
        return false;
    }

  return (
    rows.some((row) => row.id === location.rowId) &&
    columns.some((column) => column.id === location.columnId)
  );
}

export function syncActiveCell(options: {
    focusMode: "row" | "cell";
    rows: VioletPresentationIdLike[];
    columns: VioletPresentationIdLike[];
    activeCell: VioletPresentationLocationLike | null;
}): VioletPresentationLocationLike | null {
    const { focusMode, rows, columns, activeCell } = options;

    if (focusMode !== "cell") {
        return null;
    }

    if (!rows.length || !columns.length) {
        return null;
    }

    if (!activeCell) {
        return null;
    }

  const rowExists = rows.some((row) => row.id === activeCell.rowId);
  const columnExists = columns.some((column) => column.id === activeCell.columnId);

    if (!rowExists || !columnExists) {
        return resolveFirstCellLocation(rows, columns);
    }

    return activeCell;
}

export function syncCellSelection<
    LocationLike extends VioletPresentationLocationLike = VioletPresentationLocationLike,
>(options: {
    focusMode: "row" | "cell";
    activeCell: LocationLike | null;
    cellSelection: VioletPresentationRangeLike<LocationLike> | null;
    isValidLocation: (location: LocationLike | null) => boolean;
}): VioletPresentationRangeLike<LocationLike> | null {
    const { focusMode, activeCell, cellSelection, isValidLocation } = options;

    if (focusMode !== "cell") {
        return null;
    }

    if (!activeCell || !cellSelection) {
        return cellSelection;
    }

    if (!isValidLocation(cellSelection.anchor) || !isValidLocation(cellSelection.focus)) {
        return null;
    }

    return cellSelection;
}

export function syncFillPreview<
    LocationLike extends VioletPresentationLocationLike = VioletPresentationLocationLike,
>(options: {
    focusMode: "row" | "cell";
    fillPreview: VioletPresentationRangeLike<LocationLike> | null;
    isValidLocation: (location: LocationLike | null) => boolean;
}): VioletPresentationRangeLike<LocationLike> | null {
    const { focusMode, fillPreview, isValidLocation } = options;

    if (
        focusMode !== "cell" ||
        !fillPreview ||
        !isValidLocation(fillPreview.anchor) ||
        !isValidLocation(fillPreview.focus)
    ) {
        return null;
    }

    return fillPreview;
}

export function syncEditingState<
    LocationLike extends VioletPresentationLocationLike = VioletPresentationLocationLike,
>(options: {
    focusMode: "row" | "cell";
    editingCell: LocationLike | null;
    editingValue: string;
    isEditableLocation: (location: LocationLike | null) => boolean;
}): { editingCell: LocationLike | null; editingValue: string } {
    const { focusMode, editingCell, editingValue, isEditableLocation } = options;

    if (focusMode !== "cell") {
        return {
            editingCell: null,
            editingValue: "",
        };
    }

    if (!editingCell) {
        return {
            editingCell,
            editingValue,
        };
    }

    if (!isEditableLocation(editingCell)) {
        return {
            editingCell: null,
            editingValue: "",
        };
    }

    return {
        editingCell,
        editingValue,
    };
}

export function withInteractionState<
    RowLike extends VioletPresentationRowLike<CellLike>,
    CellLike extends VioletPresentationCellLike,
>(
    row: RowLike,
    options: {
        isActiveCell: (rowId: string, columnId: string) => boolean;
        isCellSelected: (rowId: string, columnId: string) => boolean;
        isFillPreviewCell: (rowId: string, columnId: string) => boolean;
        rangeEdgeForCell: (rowId: string, columnId: string) => string;
        isEditingCell: (rowId: string, columnId: string) => boolean;
        editingValue: string;
    editingError: string;
        resolveCellPartText: (rowId: string, columnId: string, basePartText: string) => string;
  },
): RowLike {
    return {
        ...row,
    cells: row.cells.map((cell) => {
            const editing = options.isEditingCell(cell.rowId, cell.columnId);

            return {
                ...cell,
                active: options.isActiveCell(cell.rowId, cell.columnId),
                selected: options.isCellSelected(cell.rowId, cell.columnId),
                fillPreview: options.isFillPreviewCell(cell.rowId, cell.columnId),
                rangeEdge: options.rangeEdgeForCell(cell.rowId, cell.columnId),
                editing,
                editValue: editing ? options.editingValue : "",
        editingError: editing ? options.editingError : "",
        resolvedCellPartText: options.resolveCellPartText(
          cell.rowId,
          cell.columnId,
          cell.cellPartText,
        ),
            };
        }),
    };
}

export function createPresentedColumn<RowData>(
    column: VioletPresentationSourceColumnLike<RowData>,
    options: {
        resolvedWidth: string | undefined;
        mergePartNames: (base: string, extra?: string) => string;
  },
): VioletPresentationColumnLike<RowData> {
  const resolvedWidth =
    safeCssValue("width", options.resolvedWidth) ??
    "var(--violet-data-grid-default-column-width, 12rem)";

    return {
        id: column.id,
        label: column.label,
        sortable: column.sortable ?? false,
        width: resolvedWidth,
        widthStyle: `width:${resolvedWidth};inline-size:${resolvedWidth};min-inline-size:${resolvedWidth};max-inline-size:${resolvedWidth};`,
        align: column.align ?? "start",
        headerPart: column.headerPart,
        headerPartText: options.mergePartNames("header-cell", column.headerPart),
        cellPart: column.cellPart,
        cellPartText: options.mergePartNames("cell", column.cellPart),
        source: column,
    };
}

export function createPresentedRow<RowData, EditorOption>(
    row: VioletPresentationSourceRowLike<RowData>,
    columns: VioletPresentationColumnLike<RowData>[],
    options: {
        cellValueFor: (
            row: VioletPresentationSourceRowLike<RowData>,
      column: VioletPresentationColumnLike<RowData>,
        ) => unknown;
        serializeCellValue: (
            column: VioletPresentationSourceColumnLike<RowData>,
            rowData: RowData,
      rawValue: unknown,
        ) => string;
        cellIdFor: (rowId: string, columnId: string) => string;
    editingErrorIdFor: (rowId: string, columnId: string) => string;
        editorOptionsForColumn: (
            column: VioletPresentationSourceColumnLike<RowData>,
      rowData: RowData,
        ) => EditorOption[];
  },
): {
    id: string;
    label: string;
    data: RowData;
    cells: Array<{
        rowId: string;
        rowLabel: string;
        columnId: string;
        columnLabel: string;
        rowData: RowData;
        align: "start" | "center" | "end";
        rawValue: unknown;
        text: string;
        widthStyle: string;
        cellId: string;
        active: boolean;
        selected: boolean;
        rangeEdge: string;
        editable: boolean;
        editor: "text" | "number" | "checkbox" | "select" | "custom";
        editing: boolean;
        editValue: string;
    editingError: string;
    editingErrorId: string;
        fillPreview: boolean;
        cellPart?: string;
        cellPartText: string;
        resolvedCellPartText: string;
        cellTemplate?: ContentTemplate;
        editorTemplate?: ContentTemplate;
        editorOptions: EditorOption[];
        parse?: (value: unknown, row: RowData) => unknown;
    }>;
} {
    const rowLabel = row.label?.trim() || row.id;
    return {
        id: row.id,
        label: rowLabel,
        data: row.data,
    cells: columns.map((column) => {
            const rawValue = options.cellValueFor(row, column);

            return {
                rowId: row.id,
                rowLabel,
                columnId: column.id,
                columnLabel: column.label,
                rowData: row.data,
                align: column.align,
                rawValue,
                text: options.serializeCellValue(column.source, row.data, rawValue),
                widthStyle: column.widthStyle,
                cellId: options.cellIdFor(row.id, column.id),
                active: false,
                selected: false,
                rangeEdge: "",
                editable: column.source.editable ?? false,
                editor: column.source.editor ?? "text",
                editing: false,
                editValue: "",
        editingError: "",
        editingErrorId: options.editingErrorIdFor(row.id, column.id),
                fillPreview: false,
                cellPart: column.cellPart,
                cellPartText: column.cellPartText,
                resolvedCellPartText: column.cellPartText,
                cellTemplate: column.source.cellTemplate,
                editorTemplate: column.source.editorTemplate,
                editorOptions: options.editorOptionsForColumn(column.source, row.data),
                parse: column.source.parse,
            };
        }),
    };
}

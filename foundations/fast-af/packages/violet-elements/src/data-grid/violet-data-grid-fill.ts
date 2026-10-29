import { parseTsv } from "./violet-data-grid-clipboard";
import type {
    VioletDataGridBoundsLike,
    VioletDataGridIdLike,
    VioletDataGridLocationLike,
} from "./violet-data-grid-selection";

export interface VioletDataGridMatrixCellLike {
    editable: boolean;
    editor?: string;
    rawValue?: unknown;
    text: string;
}

export interface VioletDataGridMatrixRowLike<
    CellLike extends VioletDataGridMatrixCellLike = VioletDataGridMatrixCellLike,
> extends VioletDataGridIdLike {
    cells: CellLike[];
}

export interface VioletDataGridMatrixChangeLike {
    rowId: string;
    columnId: string;
    value: unknown;
}

function cellAtLocation<CellLike extends VioletDataGridMatrixCellLike>(
    rows: VioletDataGridMatrixRowLike<CellLike>[],
    columns: VioletDataGridIdLike[],
    location: VioletDataGridLocationLike
): CellLike | null {
    const row = rows.find(candidate => candidate.id === location.rowId);
    const columnIndex = columns.findIndex(column => column.id === location.columnId);
    if (!row || columnIndex < 0) {
        return null;
    }

    return row.cells[columnIndex] ?? null;
}

export function hasEditableCellsInBounds<CellLike extends VioletDataGridMatrixCellLike>(
    rows: VioletDataGridMatrixRowLike<CellLike>[],
    bounds: VioletDataGridBoundsLike | null
): boolean {
    if (!bounds) {
        return false;
    }

    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row) {
            continue;
        }

        for (let columnIndex = bounds.columnStart; columnIndex <= bounds.columnEnd; columnIndex += 1) {
            if (row.cells[columnIndex]?.editable) {
                return true;
            }
        }
    }

    return false;
}

export function isEditableStrip<CellLike extends VioletDataGridMatrixCellLike>(
    rows: VioletDataGridMatrixRowLike<CellLike>[],
    rowStart: number,
    rowEnd: number,
    columnStart: number,
    columnEnd: number
): boolean {
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row) {
            return false;
        }

        for (let columnIndex = columnStart; columnIndex <= columnEnd; columnIndex += 1) {
            if (!row.cells[columnIndex]?.editable) {
                return false;
            }
        }
    }

    return true;
}

export function clampFillBoundsToEditableTargets<CellLike extends VioletDataGridMatrixCellLike>(
    rows: VioletDataGridMatrixRowLike<CellLike>[],
    expandedBounds: VioletDataGridBoundsLike,
    sourceBounds: VioletDataGridBoundsLike
): VioletDataGridBoundsLike {
    const clamped = { ...sourceBounds };

    for (let rowIndex = sourceBounds.rowStart - 1; rowIndex >= expandedBounds.rowStart; rowIndex -= 1) {
        if (!isEditableStrip(rows, rowIndex, rowIndex, clamped.columnStart, clamped.columnEnd)) {
            break;
        }

        clamped.rowStart = rowIndex;
    }

    for (let rowIndex = sourceBounds.rowEnd + 1; rowIndex <= expandedBounds.rowEnd; rowIndex += 1) {
        if (!isEditableStrip(rows, rowIndex, rowIndex, clamped.columnStart, clamped.columnEnd)) {
            break;
        }

        clamped.rowEnd = rowIndex;
    }

    for (let columnIndex = sourceBounds.columnStart - 1; columnIndex >= expandedBounds.columnStart; columnIndex -= 1) {
        if (!isEditableStrip(rows, clamped.rowStart, clamped.rowEnd, columnIndex, columnIndex)) {
            break;
        }

        clamped.columnStart = columnIndex;
    }

    for (let columnIndex = sourceBounds.columnEnd + 1; columnIndex <= expandedBounds.columnEnd; columnIndex += 1) {
        if (!isEditableStrip(rows, clamped.rowStart, clamped.rowEnd, columnIndex, columnIndex)) {
            break;
        }

        clamped.columnEnd = columnIndex;
    }

    return clamped;
}

export function buildPasteChanges<CellLike extends VioletDataGridMatrixCellLike>(options: {
    text: string;
    originIndices: { rowIndex: number; columnIndex: number };
    selection: VioletDataGridBoundsLike | null;
    selectedLocations: VioletDataGridLocationLike[];
    rows: VioletDataGridMatrixRowLike<CellLike>[];
    columns: VioletDataGridIdLike[];
    normalizeValue: (cell: CellLike, value: string) => unknown;
}): VioletDataGridMatrixChangeLike[] {
    const {
        text,
        originIndices,
        selection,
        selectedLocations,
        rows,
        columns,
        normalizeValue,
    } = options;

    const matrix = parseTsv(text);
    const isSingleValuePaste = matrix.length === 1 && (matrix[0]?.length ?? 0) === 1;

    if (selection && isSingleValuePaste) {
        return selectedLocations.flatMap(location => {
            const cell = cellAtLocation(rows, columns, location);
            if (!cell?.editable) {
                return [];
            }

            return [
                {
                    rowId: location.rowId,
                    columnId: location.columnId,
                    value: normalizeValue(cell, matrix[0]?.[0] ?? ""),
                },
            ];
        });
    }

    const changes: VioletDataGridMatrixChangeLike[] = [];

    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
        const values = matrix[rowOffset] ?? [];
        const row = rows[originIndices.rowIndex + rowOffset];
        if (!row) {
            break;
        }

        for (let columnOffset = 0; columnOffset < values.length; columnOffset += 1) {
            const column = columns[originIndices.columnIndex + columnOffset];
            const cell = row.cells[originIndices.columnIndex + columnOffset];
            if (!column || !cell) {
                break;
            }

            if (!cell.editable) {
                continue;
            }

            changes.push({
                rowId: row.id,
                columnId: column.id,
                value: normalizeValue(cell, values[columnOffset] ?? ""),
            });
        }
    }

    return changes;
}

/** Modulo that stays in [0, divisor) for negative offsets (upward/leftward fills). */
function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

export function buildFillChanges<CellLike extends VioletDataGridMatrixCellLike>(options: {
    rows: VioletDataGridMatrixRowLike<CellLike>[];
    columns: VioletDataGridIdLike[];
    sourceBounds: VioletDataGridBoundsLike;
    targetBounds: VioletDataGridBoundsLike;
    normalizeValue: (cell: CellLike, value: string) => unknown;
}): VioletDataGridMatrixChangeLike[] {
    const {
        rows,
        columns,
        sourceBounds,
        targetBounds,
        normalizeValue,
    } = options;

    const sourceHeight = sourceBounds.rowEnd - sourceBounds.rowStart + 1;
    const sourceWidth = sourceBounds.columnEnd - sourceBounds.columnStart + 1;
    const changes: VioletDataGridMatrixChangeLike[] = [];

    for (let rowIndex = targetBounds.rowStart; rowIndex <= targetBounds.rowEnd; rowIndex += 1) {
        for (let columnIndex = targetBounds.columnStart; columnIndex <= targetBounds.columnEnd; columnIndex += 1) {
            const inSource =
                rowIndex >= sourceBounds.rowStart &&
                rowIndex <= sourceBounds.rowEnd &&
                columnIndex >= sourceBounds.columnStart &&
                columnIndex <= sourceBounds.columnEnd;

            if (inSource) {
                continue;
            }

            const targetRow = rows[rowIndex];
            const targetColumn = columns[columnIndex];
            const targetCell = targetRow?.cells[columnIndex];
            if (!targetRow || !targetColumn || !targetCell?.editable) {
                continue;
            }

            const sourceRowIndex = sourceBounds.rowStart + positiveModulo(rowIndex - sourceBounds.rowStart, sourceHeight);
            const sourceColumnIndex = sourceBounds.columnStart + positiveModulo(columnIndex - sourceBounds.columnStart, sourceWidth);
            const sourceCell = rows[sourceRowIndex]?.cells[sourceColumnIndex];
            if (!sourceCell) {
                continue;
            }

            const rawValue = sourceCell.rawValue ?? sourceCell.text;
            changes.push({
                rowId: targetRow.id,
                columnId: targetColumn.id,
                value:
                    targetCell.editor === "number"
                        ? normalizeValue(targetCell, String(rawValue ?? ""))
                        : rawValue,
            });
        }
    }

    return changes;
}

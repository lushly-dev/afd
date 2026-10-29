export interface VioletDataGridNavigationLocationLike {
    rowId: string;
    columnId: string;
}

export interface VioletDataGridNavigationRowLike {
    id: string;
}

export interface VioletDataGridNavigationColumnLike {
    id: string;
}

export interface VioletDataGridCellRangeLike<Location> {
    anchor: Location;
    focus: Location;
}

export function firstCellLocation<
    RowLike extends VioletDataGridNavigationRowLike,
    ColumnLike extends VioletDataGridNavigationColumnLike,
>(rows: RowLike[], columns: ColumnLike[]): { rowId: string; columnId: string } | null {
    const rowId = rows[0]?.id;
    const columnId = columns[0]?.id;

    if (!rowId || !columnId) {
        return null;
    }

    return { rowId, columnId };
}

export function createCellSelection<Location extends VioletDataGridNavigationLocationLike>(
    anchor: Location,
    focus: Location
): VioletDataGridCellRangeLike<Location> | null {
    if (anchor.rowId === focus.rowId && anchor.columnId === focus.columnId) {
        return null;
    }

    return { anchor, focus };
}

export function nextCellLocationForKey<
    RowLike extends VioletDataGridNavigationRowLike,
    ColumnLike extends VioletDataGridNavigationColumnLike,
>(options: {
    rows: RowLike[];
    columns: ColumnLike[];
    activeCell: VioletDataGridNavigationLocationLike | null;
    key: string;
    metaKey: boolean;
}): { rowId: string; columnId: string } | null {
    const fallback = firstCellLocation(options.rows, options.columns);
    const current = options.activeCell ?? fallback;
    if (!current || !options.rows.length || !options.columns.length) {
        return null;
    }

    const rowIndex = options.rows.findIndex(row => row.id === current.rowId);
    const columnIndex = options.columns.findIndex(column => column.id === current.columnId);

    if (rowIndex < 0 || columnIndex < 0) {
        return fallback;
    }

    const lastRowIndex = options.rows.length - 1;
    const lastColumnIndex = options.columns.length - 1;

    let nextRowIndex = rowIndex;
    let nextColumnIndex = columnIndex;

    switch (options.key) {
        case "ArrowUp":
            nextRowIndex = Math.max(0, rowIndex - 1);
            break;
        case "ArrowDown":
            nextRowIndex = Math.min(lastRowIndex, rowIndex + 1);
            break;
        case "ArrowLeft":
            nextColumnIndex = Math.max(0, columnIndex - 1);
            break;
        case "ArrowRight":
            nextColumnIndex = Math.min(lastColumnIndex, columnIndex + 1);
            break;
        case "Home":
            if (options.metaKey) {
                nextRowIndex = 0;
            }
            nextColumnIndex = 0;
            break;
        case "End":
            if (options.metaKey) {
                nextRowIndex = lastRowIndex;
            }
            nextColumnIndex = lastColumnIndex;
            break;
        default:
            return null;
    }

    return {
        rowId: options.rows[nextRowIndex]?.id ?? current.rowId,
        columnId: options.columns[nextColumnIndex]?.id ?? current.columnId,
    };
}

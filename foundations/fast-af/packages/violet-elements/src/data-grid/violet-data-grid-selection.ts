export interface VioletDataGridIdLike {
    id: string;
}

export interface VioletDataGridLocationLike {
    rowId: string;
    columnId: string;
}

export interface VioletDataGridRangeLike<LocationLike extends VioletDataGridLocationLike = VioletDataGridLocationLike> {
    anchor: LocationLike;
    focus: LocationLike;
}

export interface VioletDataGridBoundsLike {
    rowStart: number;
    rowEnd: number;
    columnStart: number;
    columnEnd: number;
}

export function cellIndicesForLocation(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    location: VioletDataGridLocationLike
): { rowIndex: number; columnIndex: number } | null {
    const rowIndex = rows.findIndex(row => row.id === location.rowId);
    const columnIndex = columns.findIndex(column => column.id === location.columnId);

    if (rowIndex < 0 || columnIndex < 0) {
        return null;
    }

    return { rowIndex, columnIndex };
}

export function locationForIndices(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    rowIndex: number,
    columnIndex: number
): VioletDataGridLocationLike | null {
    const row = rows[rowIndex];
    const column = columns[columnIndex];
    if (!row || !column) {
        return null;
    }

    return {
        rowId: row.id,
        columnId: column.id,
    };
}

export function boundsForRange(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    range: VioletDataGridRangeLike | null
): VioletDataGridBoundsLike | null {
    if (!range) {
        return null;
    }

    const anchor = cellIndicesForLocation(rows, columns, range.anchor);
    const focus = cellIndicesForLocation(rows, columns, range.focus);
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

export function rangeFromBounds(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    bounds: VioletDataGridBoundsLike
): VioletDataGridRangeLike | null {
    const anchor = locationForIndices(rows, columns, bounds.rowStart, bounds.columnStart);
    const focus = locationForIndices(rows, columns, bounds.rowEnd, bounds.columnEnd);
    return anchor && focus ? { anchor, focus } : null;
}

export function selectedLocations(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    selection: VioletDataGridBoundsLike | null,
    activeCell: VioletDataGridLocationLike | null
): VioletDataGridLocationLike[] {
    if (!selection) {
        return activeCell ? [activeCell] : [];
    }

    const locations: VioletDataGridLocationLike[] = [];

    for (let rowIndex = selection.rowStart; rowIndex <= selection.rowEnd; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row) {
            continue;
        }

        for (let columnIndex = selection.columnStart; columnIndex <= selection.columnEnd; columnIndex += 1) {
            const column = columns[columnIndex];
            if (!column) {
                continue;
            }

            locations.push({
                rowId: row.id,
                columnId: column.id,
            });
        }
    }

    return locations;
}

export function nextTabLocation(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    current: VioletDataGridLocationLike,
    direction: -1 | 1
): VioletDataGridLocationLike | null {
    const currentIndices = cellIndicesForLocation(rows, columns, current);
    if (!currentIndices) {
        return null;
    }

    const currentPosition = currentIndices.rowIndex * columns.length + currentIndices.columnIndex;
    const nextPosition = currentPosition + direction;
    if (nextPosition < 0 || nextPosition >= rows.length * columns.length) {
        return null;
    }

    const rowIndex = Math.floor(nextPosition / columns.length);
    const columnIndex = nextPosition % columns.length;
    return locationForIndices(rows, columns, rowIndex, columnIndex);
}

export function locationWithinBounds(
    rows: VioletDataGridIdLike[],
    columns: VioletDataGridIdLike[],
    location: VioletDataGridLocationLike,
    bounds: VioletDataGridBoundsLike
): boolean {
    const indices = cellIndicesForLocation(rows, columns, location);
    if (!indices) {
        return false;
    }

    return (
        indices.rowIndex >= bounds.rowStart &&
        indices.rowIndex <= bounds.rowEnd &&
        indices.columnIndex >= bounds.columnStart &&
        indices.columnIndex <= bounds.columnEnd
    );
}

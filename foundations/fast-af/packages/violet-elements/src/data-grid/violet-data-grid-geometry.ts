export interface VioletDataGridLocationLike {
    rowId: string;
    columnId: string;
}

export function locationFromCellElement(cell: HTMLTableCellElement): VioletDataGridLocationLike | null {
    const rowId = cell.dataset.rowId;
    const columnId = cell.dataset.columnId;

    if (!rowId || !columnId) {
        return null;
    }

    return { rowId, columnId };
}

export function nearestLocationForPoint(options: {
    cells: HTMLTableCellElement[];
    clientX: number;
    clientY: number;
    predicate?: (location: VioletDataGridLocationLike) => boolean;
}): VioletDataGridLocationLike | null {
    const {
        cells,
        clientX,
        clientY,
        predicate,
    } = options;

    if (!cells.length) {
        return null;
    }

    let bestCell: HTMLTableCellElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const cell of cells) {
        const location = locationFromCellElement(cell);
        if (!location || (predicate && !predicate(location))) {
            continue;
        }

        const rect = cell.getBoundingClientRect();
        const clampedX = Math.min(Math.max(clientX, rect.left), rect.right);
        const clampedY = Math.min(Math.max(clientY, rect.top), rect.bottom);
        const distance = Math.hypot(clientX - clampedX, clientY - clampedY);

        if (distance < bestDistance) {
            bestDistance = distance;
            bestCell = cell;
        }
    }

    return bestCell ? locationFromCellElement(bestCell) : null;
}

export function preferredAxisForPoint(
    clientX: number,
    clientY: number,
    sourceRect: DOMRect | null
): "horizontal" | "vertical" | null {
    if (!sourceRect) {
        return null;
    }

    const horizontalDistance =
        clientX < sourceRect.left
            ? sourceRect.left - clientX
            : clientX > sourceRect.right
              ? clientX - sourceRect.right
              : 0;

    const verticalDistance =
        clientY < sourceRect.top
            ? sourceRect.top - clientY
            : clientY > sourceRect.bottom
              ? clientY - sourceRect.bottom
              : 0;

    if (horizontalDistance === 0 && verticalDistance === 0) {
        return null;
    }

    return horizontalDistance >= verticalDistance ? "horizontal" : "vertical";
}

export function rectFromCellPair(
    startCell: HTMLTableCellElement | null,
    endCell: HTMLTableCellElement | null
): DOMRect | null {
    if (!startCell || !endCell) {
        return null;
    }

    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();
    return new DOMRect(
        Math.min(startRect.left, endRect.left),
        Math.min(startRect.top, endRect.top),
        Math.max(startRect.right, endRect.right) - Math.min(startRect.left, endRect.left),
        Math.max(startRect.bottom, endRect.bottom) - Math.min(startRect.top, endRect.top)
    );
}

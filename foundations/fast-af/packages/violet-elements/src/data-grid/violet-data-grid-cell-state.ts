export interface VioletDataGridBoundsLike {
    rowStart: number;
    rowEnd: number;
    columnStart: number;
    columnEnd: number;
}

export interface VioletDataGridIndicesLike {
    rowIndex: number;
    columnIndex: number;
}

export function isCellSelected(
    selection: VioletDataGridBoundsLike | null,
    indices: VioletDataGridIndicesLike | null
): boolean {
    if (!selection || !indices) {
        return false;
    }

    return (
        indices.rowIndex >= selection.rowStart &&
        indices.rowIndex <= selection.rowEnd &&
        indices.columnIndex >= selection.columnStart &&
        indices.columnIndex <= selection.columnEnd
    );
}

export function rangeEdgeForCell(
    selection: VioletDataGridBoundsLike | null,
    indices: VioletDataGridIndicesLike | null
): string {
    if (!selection || !indices) {
        return "";
    }

    const edges: string[] = [];

    if (indices.rowIndex === selection.rowStart) {
        edges.push("top");
    }

    if (indices.rowIndex === selection.rowEnd) {
        edges.push("bottom");
    }

    if (indices.columnIndex === selection.columnStart) {
        edges.push("left");
    }

    if (indices.columnIndex === selection.columnEnd) {
        edges.push("right");
    }

    return edges.join(" ");
}

export function isFillPreviewCell(
    previewBounds: VioletDataGridBoundsLike | null,
    sourceBounds: VioletDataGridBoundsLike | null,
    indices: VioletDataGridIndicesLike | null
): boolean {
    if (!previewBounds || !indices) {
        return false;
    }

    const inPreview =
        indices.rowIndex >= previewBounds.rowStart &&
        indices.rowIndex <= previewBounds.rowEnd &&
        indices.columnIndex >= previewBounds.columnStart &&
        indices.columnIndex <= previewBounds.columnEnd;

    if (!inPreview) {
        return false;
    }

    if (!sourceBounds) {
        return true;
    }

    const inSource =
        indices.rowIndex >= sourceBounds.rowStart &&
        indices.rowIndex <= sourceBounds.rowEnd &&
        indices.columnIndex >= sourceBounds.columnStart &&
        indices.columnIndex <= sourceBounds.columnEnd;

    return !inSource;
}

export function resolveCellPartText(
    basePartText: string,
    options: {
        selected: boolean;
        rangeEdge: string;
        fillPreview: boolean;
        active: boolean;
        editing: boolean;
    }
): string {
    const partNames = [basePartText];

    if (options.selected) {
        partNames.push("selected-cell");

        if (options.rangeEdge) {
            partNames.push("selected-range-edge");
        }
    }

    if (options.fillPreview) {
        partNames.push("fill-preview-cell");
    }

    if (options.active) {
        partNames.push("active-cell");
    }

    if (options.editing) {
        partNames.push("editing-cell");
    }

    return partNames.join(" ");
}

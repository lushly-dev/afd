import type { VioletDataGridIdLike } from "./violet-data-grid-selection";

export interface VioletDataGridSizedColumnLike extends VioletDataGridIdLike {
    label: string;
    sortable: boolean;
}

export function resolvedColumnWidth(
    columnId: string,
    columnWidths: Record<string, string> | null | undefined,
    sourceColumns: Array<{ id: string; width?: string }>
): string | undefined {
    const sourceColumn = sourceColumns.find(column => column.id === columnId);
    return columnWidths?.[columnId] ?? sourceColumn?.width;
}

export function inlinePadding(element: Element): number {
    const style = getComputedStyle(element);
    return parseFloat(style.paddingInlineStart || "0") + parseFloat(style.paddingInlineEnd || "0");
}

export function fontForElement(element: Element | null): string {
    if (!element) {
        return '500 14px "IBM Plex Sans", "Segoe UI", sans-serif';
    }

    const style = getComputedStyle(element);
    return (
        style.font ||
        `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`
    );
}

export function measureTextWidth(
    text: string,
    font: string,
    canvas: HTMLCanvasElement | null
): number {
    const resolvedCanvas = canvas ?? document.createElement("canvas");
    const context = resolvedCanvas.getContext("2d");
    if (!context) {
        return text.length * 8;
    }

    context.font = font;
    return context.measureText(text).width;
}

export function cssLengthToPixels(length: string | undefined): number | null {
    if (!length) {
        return null;
    }

    if (length.endsWith("px")) {
        return Number.parseFloat(length);
    }

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.inlineSize = length;
    document.body.append(probe);
    const pixels = probe.getBoundingClientRect().width;
    probe.remove();
    return pixels || null;
}

export function minimumColumnWidth(
    headerCell: HTMLTableCellElement | null
): number {
    const padding = headerCell ? inlinePadding(headerCell) : 0;
    return Math.max(72, Math.ceil(32 + padding));
}

export function renderedColumnWidth(options: {
    headerCell: HTMLTableCellElement | null;
    resolvedWidth: string | undefined;
}): number {
    const {
        headerCell,
        resolvedWidth,
    } = options;

    const renderedWidth = headerCell?.getBoundingClientRect().width;

    if (renderedWidth && renderedWidth > 0) {
        return renderedWidth;
    }

    return cssLengthToPixels(resolvedWidth) ?? minimumColumnWidth(headerCell);
}

export function autosizedColumnWidth<RowLike extends VioletDataGridIdLike>(options: {
    columnId: string;
    column: VioletDataGridSizedColumnLike | null;
    rows: RowLike[];
    headerCell: HTMLTableCellElement | null;
    sampleCell: HTMLTableCellElement | null;
    getCellText: (location: { rowId: string; columnId: string }) => string;
    sampleRows: RowLike[];
    measurementCanvas: HTMLCanvasElement | null;
}): number {
    const {
        columnId,
        column,
        headerCell,
        sampleCell,
        getCellText,
        sampleRows,
        measurementCanvas,
    } = options;

    if (!column) {
        return minimumColumnWidth(headerCell);
    }

    const headerFont = fontForElement(headerCell);
    const cellFont = fontForElement(sampleCell);
    const headerPadding = headerCell ? inlinePadding(headerCell) : 0;
    const cellPadding = sampleCell ? inlinePadding(sampleCell) : headerPadding;
    const sortAllowance = column.sortable ? 24 : 0;
    const resizeAllowance = 14;

    let maxCellTextWidth = 0;
    for (const row of sampleRows) {
        const width = measureTextWidth(getCellText({ rowId: row.id, columnId }), cellFont, measurementCanvas);
        if (width > maxCellTextWidth) {
            maxCellTextWidth = width;
        }
    }

    const headerTextWidth = measureTextWidth(column.label, headerFont, measurementCanvas);
    const preferredWidth = Math.ceil(
        Math.max(
            headerTextWidth + headerPadding + sortAllowance + resizeAllowance,
            maxCellTextWidth + cellPadding
        )
    );

    return Math.max(minimumColumnWidth(headerCell), preferredWidth);
}

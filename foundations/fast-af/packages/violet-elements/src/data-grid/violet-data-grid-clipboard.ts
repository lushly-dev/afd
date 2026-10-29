export interface VioletDataGridLocationLike {
    rowId: string;
    columnId: string;
}

export interface VioletDataGridBoundsLike {
    rowStart: number;
    rowEnd: number;
    columnStart: number;
    columnEnd: number;
}

export interface VioletDataGridIdRowLike {
    id: string;
}

export interface VioletDataGridIdColumnLike {
    id: string;
}

export function sampleAutosizeRows<RowLike>(rows: RowLike[]): RowLike[] {
    if (rows.length <= 150) {
        return rows;
    }

    const sample = rows.slice(0, 100);
    const remaining = rows.length - 100;
    const stride = Math.max(1, Math.floor(remaining / 50));

    for (let index = 100; index < rows.length && sample.length < 150; index += stride) {
        const row = rows[index];
        if (row) {
            sample.push(row);
        }
    }

    const lastRow = rows[rows.length - 1];
    if (lastRow && !sample.includes(lastRow)) {
        sample.push(lastRow);
    }

    return sample;
}

/**
 * Quotes a cell for tab-separated text the way spreadsheets do: cells that
 * contain a tab, newline or double quote are wrapped in quotes with embedded
 * quotes doubled, so the cell survives a round trip through `parseTsv`.
 */
export function quoteTsvCell(text: string): string {
    return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Parses tab-separated text (rows split on newlines) honouring quoted cells,
 * the inverse of `quoteTsvCell`. A quote only opens a quoted cell at the start
 * of a field; elsewhere it is literal. Expects line endings already normalised
 * to "\n" (see `normalizePastedText`).
 */
export function parseTsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let index = 0;
    let atFieldStart = true;

    while (index < text.length) {
        const character = text[index]!;

        if (atFieldStart && character === '"') {
            index += 1;
            while (index < text.length) {
                if (text[index] === '"') {
                    if (text[index + 1] === '"') {
                        field += '"';
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                field += text[index];
                index += 1;
            }
            atFieldStart = false;
            continue;
        }

        if (character === "\t") {
            row.push(field);
            field = "";
            atFieldStart = true;
        } else if (character === "\n") {
            row.push(field);
            rows.push(row);
            row = [];
            field = "";
            atFieldStart = true;
        } else {
            field += character;
            atFieldStart = false;
        }
        index += 1;
    }

    row.push(field);
    rows.push(row);
    return rows;
}

export function copyTextForSelection(options: {
    selection: VioletDataGridBoundsLike | null;
    locations: VioletDataGridLocationLike[];
    rows: VioletDataGridIdRowLike[];
    columns: VioletDataGridIdColumnLike[];
    getCellText: (location: VioletDataGridLocationLike) => string;
}): string {
    const {
        selection,
        locations,
        rows,
        columns,
        getCellText,
    } = options;

    if (!locations.length) {
        return "";
    }

    if (!selection) {
        return quoteTsvCell(getCellText(locations[0]!));
    }

    const lines: string[] = [];

    for (let rowIndex = selection.rowStart; rowIndex <= selection.rowEnd; rowIndex += 1) {
        const cells: string[] = [];

        for (let columnIndex = selection.columnStart; columnIndex <= selection.columnEnd; columnIndex += 1) {
            const row = rows[rowIndex];
            const column = columns[columnIndex];

            if (!row || !column) {
                continue;
            }

            cells.push(
                quoteTsvCell(
                    getCellText({
                        rowId: row.id,
                        columnId: column.id,
                    })
                )
            );
        }

        lines.push(cells.join("\t"));
    }

    return lines.join("\n");
}

export function normalizePastedText(text: string): string {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

export function resolvePasteOriginLocation(options: {
    selection: VioletDataGridBoundsLike | null;
    rows: VioletDataGridIdRowLike[];
    columns: VioletDataGridIdColumnLike[];
    activeCell: VioletDataGridLocationLike | null;
}): VioletDataGridLocationLike | null {
    const {
        selection,
        rows,
        columns,
        activeCell,
    } = options;

    if (!selection) {
        return activeCell;
    }

    const row = rows[selection.rowStart];
    const column = columns[selection.columnStart];
    if (!row || !column) {
        return activeCell;
    }

    return {
        rowId: row.id,
        columnId: column.id,
    };
}

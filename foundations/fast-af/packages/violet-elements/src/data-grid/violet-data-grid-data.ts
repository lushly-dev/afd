export interface VioletDataGridDataColumnLike<RowData = unknown> {
    id: string;
    sortable?: boolean;
    editor?: string;
    render?: (rowData: RowData) => unknown;
    value?: (rowData: RowData) => unknown;
    serialize?: (rawValue: unknown, rowData: RowData) => string;
    editorOptions?: unknown[] | ((rowData: RowData) => unknown[]);
}

export interface VioletDataGridDataRowLike<RowData = unknown> {
    id: string;
    data: RowData;
}

export interface VioletDataGridSortLike {
    columnId: string;
    direction: "ascending" | "descending";
}

export function cellValueFor<RowData>(
    row: VioletDataGridDataRowLike<RowData>,
    column: VioletDataGridDataColumnLike<RowData>
): unknown {
    return (
        column.render?.(row.data) ??
        column.value?.(row.data) ??
        (column.id in Object(row.data) ? (row.data as Record<string, unknown>)[column.id] : undefined)
    );
}

export function editorOptionsForColumn<RowData, Option>(
    column: VioletDataGridDataColumnLike<RowData>,
    rowData: RowData
): Option[] {
    if (!column.editorOptions) {
        return [];
    }

    return typeof column.editorOptions === "function"
        ? (column.editorOptions(rowData) as Option[])
        : (column.editorOptions as Option[]);
}

function dateToIsoString(value: Date): string {
    // toISOString() throws a RangeError for Invalid Date; render those as empty.
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
}

export function stringifyUnknown(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }

    if (value instanceof Date) {
        return dateToIsoString(value);
    }

    if (typeof Node !== "undefined" && value instanceof Node) {
        return value.textContent ?? "";
    }

    if (Array.isArray(value)) {
        return value.map(item => stringifyUnknown(item)).join(", ");
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function stringifyCellValue(rawValue: unknown): string {
    if (rawValue === null || rawValue === undefined) {
        return "";
    }

    if (
        typeof rawValue === "string" ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean" ||
        typeof rawValue === "bigint"
    ) {
        return String(rawValue);
    }

    if (rawValue instanceof Date) {
        return dateToIsoString(rawValue);
    }

    if (Array.isArray(rawValue)) {
        return rawValue.map(value => stringifyUnknown(value)).join(", ");
    }

    return stringifyUnknown(rawValue);
}

export function serializeCellValue<RowData>(options: {
    column: VioletDataGridDataColumnLike<RowData>;
    rowData: RowData;
    rawValue: unknown;
    booleanCellValue: (value: unknown) => boolean;
}): string {
    if (options.column.serialize) {
        return options.column.serialize(options.rawValue, options.rowData);
    }

    if (options.column.editor === "checkbox") {
        return options.booleanCellValue(options.rawValue) ? "true" : "false";
    }

    return stringifyCellValue(options.rawValue);
}

export function sortRows<RowData>(options: {
    rows: VioletDataGridDataRowLike<RowData>[] | undefined;
    columns: VioletDataGridDataColumnLike<RowData>[];
    sort: VioletDataGridSortLike | null;
    sortMode: "local" | "external";
    getSortKey?: (row: VioletDataGridDataRowLike<RowData>, column: VioletDataGridDataColumnLike<RowData>) => string;
}): VioletDataGridDataRowLike<RowData>[] {
    const sourceRows = options.rows ?? [];

    if (!options.sort || options.sortMode === "external") {
        return [...sourceRows];
    }

    const sortableColumn = options.columns.find(column => column.id === options.sort?.columnId);
    if (!sortableColumn || !sortableColumn.sortable) {
        return [...sourceRows];
    }

    const direction = options.sort.direction === "ascending" ? 1 : -1;
    const getSortKey = options.getSortKey ?? ((row, column) => stringifyCellValue(cellValueFor(row, column)));
    const collator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base",
    });
    const keyedRows = sourceRows.map(row => ({
        row,
        key: getSortKey(row, sortableColumn),
    }));

    keyedRows.sort((left, right) => collator.compare(left.key, right.key) * direction);
    return keyedRows.map(entry => entry.row);
}

import { describe, expect, it } from "vitest";

import { firstCellLocation } from "./violet-data-grid-navigation";
import {
    createPresentedColumn,
    createPresentedRow,
    isValidCellLocation,
    syncActiveCell,
    syncCellSelection,
    syncEditingState,
    syncFillPreview,
    withInteractionState,
} from "./violet-data-grid-presentation";

const rows = [{ id: "row-1" }, { id: "row-2" }];
const columns = [{ id: "plant" }, { id: "status" }];

describe("violet-data-grid-presentation helpers", () => {
    it("derives the first cell location and validates cell existence", () => {
        expect(firstCellLocation(rows, columns)).toEqual({
            rowId: "row-1",
            columnId: "plant",
        });
        expect(isValidCellLocation(rows, columns, { rowId: "row-2", columnId: "status" })).toBe(true);
    expect(isValidCellLocation(rows, columns, { rowId: "missing", columnId: "status" })).toBe(
      false,
    );
    });

    it("syncs the active cell against focus mode and presented ids", () => {
        expect(
            syncActiveCell({
                focusMode: "row",
                rows,
                columns,
                activeCell: { rowId: "row-1", columnId: "plant" },
      }),
        ).toBeNull();

        expect(
            syncActiveCell({
                focusMode: "cell",
                rows,
                columns,
                activeCell: { rowId: "missing", columnId: "plant" },
      }),
        ).toEqual({
            rowId: "row-1",
            columnId: "plant",
        });
    });

    it("clears invalid range/fill state and invalid editing state", () => {
        const isValidLocation = (location: { rowId: string; columnId: string } | null) =>
            Boolean(location && location.rowId === "row-1");

        expect(
            syncCellSelection({
                focusMode: "cell",
                activeCell: { rowId: "row-1", columnId: "plant" },
                cellSelection: {
                    anchor: { rowId: "row-1", columnId: "plant" },
                    focus: { rowId: "row-2", columnId: "status" },
                },
                isValidLocation,
      }),
        ).toBeNull();

        expect(
            syncFillPreview({
                focusMode: "cell",
                fillPreview: {
                    anchor: { rowId: "row-1", columnId: "plant" },
                    focus: { rowId: "row-2", columnId: "status" },
                },
                isValidLocation,
      }),
        ).toBeNull();

        expect(
            syncEditingState({
                focusMode: "cell",
                editingCell: { rowId: "row-2", columnId: "status" },
                editingValue: "hello",
        isEditableLocation: (location) => Boolean(location && location.rowId === "row-1"),
      }),
        ).toEqual({
            editingCell: null,
            editingValue: "",
        });
    });

    it("projects interaction state onto presented row cells", () => {
        const row = {
            cells: [
                {
                    rowId: "row-1",
                    columnId: "plant",
                    cellPartText: "cell",
                    active: false,
                    selected: false,
                    fillPreview: false,
                    rangeEdge: "",
                    editing: false,
                    editValue: "",
          editingError: "",
          editingErrorId: "row-1-plant-edit-error",
                    resolvedCellPartText: "cell",
                },
            ],
        };

        const next = withInteractionState(row, {
            isActiveCell: () => true,
            isCellSelected: () => true,
            isFillPreviewCell: () => false,
            rangeEdgeForCell: () => "top",
            isEditingCell: () => true,
            editingValue: "seedling",
      editingError: "",
            resolveCellPartText: () => "cell active-cell",
        });

        expect(next.cells[0]).toMatchObject({
            active: true,
            selected: true,
            rangeEdge: "top",
            editing: true,
            editValue: "seedling",
      editingError: "",
            resolvedCellPartText: "cell active-cell",
        });
    });

    it("creates presented columns and rows from source definitions", () => {
        const column = createPresentedColumn(
            {
                id: "status",
                label: "Status",
                sortable: true,
                width: "12rem",
                cellPart: "status-cell",
            },
            {
                resolvedWidth: "14rem",
                mergePartNames: (base, extra) => [base, extra].filter(Boolean).join(" "),
      },
        );

        expect(column).toMatchObject({
            id: "status",
            label: "Status",
            sortable: true,
            width: "14rem",
            align: "start",
            headerPartText: "header-cell",
            cellPartText: "cell status-cell",
        });

        const row = createPresentedRow(
            {
                id: "row-1",
                data: {
                    status: "Seedling",
                },
            },
            [column],
            {
        cellValueFor: (rowValue) => rowValue.data.status,
                serializeCellValue: (_column, _rowData, rawValue) => String(rawValue ?? ""),
                cellIdFor: (rowId, columnId) => `${rowId}-${columnId}`,
        editingErrorIdFor: (rowId, columnId) => `${rowId}-${columnId}-edit-error`,
                editorOptionsForColumn: () => [{ label: "Seedling", value: "Seedling" }],
      },
        );

        expect(row.cells[0]).toMatchObject({
            rowId: "row-1",
            rowLabel: "row-1",
            columnId: "status",
            text: "Seedling",
      widthStyle: "width:14rem;inline-size:14rem;min-inline-size:14rem;max-inline-size:14rem;",
            cellId: "row-1-status",
            editable: false,
            editor: "text",
            resolvedCellPartText: "cell status-cell",
        });
        expect(row.label).toBe("row-1");
    });

    it("falls back to the default width instead of interpolating hostile widths into inline style", () => {
        const widthStyleFor = (resolvedWidth: string | undefined) =>
            createPresentedColumn(
                { id: "status", label: "Status" },
                { resolvedWidth, mergePartNames: base => base },
            ).widthStyle;
        const fallback = "var(--violet-data-grid-default-column-width, 12rem)";

        expect(widthStyleFor("14rem")).toBe(
            "width:14rem;inline-size:14rem;min-inline-size:14rem;max-inline-size:14rem;",
        );
        for (const hostile of ["10px;background:url(https://example.com/x)", "10px}a{color:red", "bogus"]) {
            const style = widthStyleFor(hostile);
            expect(style).toBe(widthStyleFor(undefined));
            expect(style).toContain(fallback);
            expect(style).not.toMatch(/url\(|background|bogus/);
        }
    });
});

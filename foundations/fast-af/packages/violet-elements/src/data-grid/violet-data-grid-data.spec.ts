import { describe, expect, it } from "vitest";

import {
    cellValueFor,
    editorOptionsForColumn,
    serializeCellValue,
    sortRows,
    stringifyCellValue,
    stringifyUnknown,
} from "./violet-data-grid-data";

describe("violet-data-grid-data helpers", () => {
    it("resolves cell values from render, value, or row properties", () => {
        const row = {
            id: "row-1",
            data: {
                commonName: "Black currant",
                dtm: 365,
            },
        };

        expect(
            cellValueFor(row, {
                id: "commonName",
            })
        ).toBe("Black currant");

        expect(
            cellValueFor(row, {
                id: "dtm",
                value: data => data.dtm + 1,
            })
        ).toBe(366);

        expect(
            cellValueFor(row, {
                id: "custom",
                render: () => "Rendered",
            })
        ).toBe("Rendered");
    });

    it("resolves static and functional editor options", () => {
        expect(
            editorOptionsForColumn(
                {
                    id: "status",
                    editorOptions: [{ label: "Seedling", value: "seedling" }],
                },
                {}
            )
        ).toEqual([{ label: "Seedling", value: "seedling" }]);

        expect(
            editorOptionsForColumn(
                {
                    id: "status",
                    editorOptions: row => [{ label: String((row as { id: string }).id), value: "custom" }],
                },
                { id: "row-1" }
            )
        ).toEqual([{ label: "row-1", value: "custom" }]);
    });

    it("stringifies unknown and cell values predictably", () => {
        expect(stringifyUnknown({ a: 1 })).toBe('{"a":1}');
        expect(stringifyCellValue(["Black currant", 365])).toBe("Black currant, 365");
        expect(stringifyCellValue(new Date("2026-03-20T00:00:00.000Z"))).toBe("2026-03-20T00:00:00.000Z");
    });

    it("serializes checkbox cells and custom serializer columns", () => {
        expect(
            serializeCellValue({
                column: {
                    id: "tracked",
                    editor: "checkbox",
                },
                rowData: {},
                rawValue: "yes",
                booleanCellValue: value => value === "yes",
            })
        ).toBe("true");

        expect(
            serializeCellValue({
                column: {
                    id: "status",
                    serialize: value => `status:${value}`,
                },
                rowData: {},
                rawValue: "Harvesting",
                booleanCellValue: Boolean,
            })
        ).toBe("status:Harvesting");
    });

    it("sorts locally while preserving order for external mode", () => {
        const rows = [
            { id: "row-2", data: { commonName: "Romanesco" } },
            { id: "row-1", data: { commonName: "Black currant" } },
        ];
        const columns = [{ id: "commonName", sortable: true }];

        expect(
            sortRows({
                rows,
                columns,
                sort: { columnId: "commonName", direction: "ascending" },
                sortMode: "local",
            }).map(row => row.id)
        ).toEqual(["row-1", "row-2"]);

        expect(
            sortRows({
                rows,
                columns,
                sort: { columnId: "commonName", direction: "ascending" },
                sortMode: "external",
            }).map(row => row.id)
        ).toEqual(["row-2", "row-1"]);
    });

    it("extracts one cached sort key per row instead of recalculating inside comparisons", () => {
        const rows = Array.from({ length: 10_000 }, (_, index) => ({
            id: `row-${index}`,
            data: { commonName: `Plant ${10_000 - index}` },
        }));
        const columns = [{ id: "commonName", sortable: true }];
        let keyReads = 0;

        const result = sortRows({
            rows,
            columns,
            sort: { columnId: "commonName", direction: "ascending" },
            sortMode: "local",
            getSortKey: row => {
                keyReads += 1;
                return row.data.commonName;
            },
        });

        expect(keyReads).toBe(rows.length);
        expect(result[0]?.data.commonName).toBe("Plant 1");
        expect(result.at(-1)?.data.commonName).toBe("Plant 10000");
    });

    it("renders Invalid Date as an empty string instead of throwing", () => {
        const invalid = new Date("not a date");

        expect(stringifyCellValue(invalid)).toBe("");
        expect(stringifyUnknown(invalid)).toBe("");
        expect(stringifyCellValue([invalid, new Date(0)])).toBe(", 1970-01-01T00:00:00.000Z");
        expect(
            serializeCellValue({
                column: { id: "when" },
                rowData: {},
                rawValue: invalid,
                booleanCellValue: Boolean,
            })
        ).toBe("");
    });

    it("sorts rows containing Invalid Dates without throwing", () => {
        const rows = [
            { id: "valid", data: { when: new Date(0) } },
            { id: "invalid", data: { when: new Date("nope") } },
        ];

        const result = sortRows({
            rows,
            columns: [{ id: "when", sortable: true }],
            sort: { columnId: "when", direction: "ascending" },
            sortMode: "local",
        });

        expect(result.map(row => row.id)).toEqual(["invalid", "valid"]);
    });
});

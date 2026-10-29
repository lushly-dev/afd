import { describe, expect, it } from "vitest";

import {
    copyTextForSelection,
    normalizePastedText,
    parseTsv,
    quoteTsvCell,
    resolvePasteOriginLocation,
    sampleAutosizeRows,
} from "./violet-data-grid-clipboard";

describe("violet-data-grid-clipboard helpers", () => {
    it("samples autosize rows with a bounded set and keeps the last row", () => {
        const rows = Array.from({ length: 500 }, (_, index) => ({ id: `row-${index}` }));

        const sample = sampleAutosizeRows(rows);

        expect(sample.length).toBeLessThanOrEqual(151);
        expect(sample[0]?.id).toBe("row-0");
        expect(sample.at(-1)?.id).toBe("row-499");
    });

    it("serializes a rectangular selection as TSV", () => {
        const text = copyTextForSelection({
            selection: {
                rowStart: 0,
                rowEnd: 1,
                columnStart: 0,
                columnEnd: 1,
            },
            locations: [
                { rowId: "row-1", columnId: "plant" },
                { rowId: "row-1", columnId: "status" },
                { rowId: "row-2", columnId: "plant" },
                { rowId: "row-2", columnId: "status" },
            ],
            rows: [{ id: "row-1" }, { id: "row-2" }],
            columns: [{ id: "plant" }, { id: "status" }],
            getCellText: location => `${location.rowId}:${location.columnId}`,
        });

        expect(text).toBe("row-1:plant\trow-1:status\nrow-2:plant\trow-2:status");
    });

    it("normalizes pasted line endings and strips a trailing newline", () => {
        expect(normalizePastedText("a\r\nb\r\n")).toBe("a\nb");
        expect(normalizePastedText("a\rb")).toBe("a\nb");
    });

    it("uses the top-left selected cell as the paste origin and falls back to the active cell", () => {
        const rows = [{ id: "row-1" }, { id: "row-2" }];
        const columns = [{ id: "plant" }, { id: "status" }];

        expect(
            resolvePasteOriginLocation({
                selection: {
                    rowStart: 1,
                    rowEnd: 1,
                    columnStart: 0,
                    columnEnd: 1,
                },
                rows,
                columns,
                activeCell: { rowId: "row-1", columnId: "plant" },
            })
        ).toEqual({
            rowId: "row-2",
            columnId: "plant",
        });

        expect(
            resolvePasteOriginLocation({
                selection: {
                    rowStart: 4,
                    rowEnd: 4,
                    columnStart: 4,
                    columnEnd: 4,
                },
                rows,
                columns,
                activeCell: { rowId: "row-1", columnId: "status" },
            })
        ).toEqual({
            rowId: "row-1",
            columnId: "status",
        });
    });

    it("quotes cells that contain tabs, newlines or quotes and leaves plain cells alone", () => {
        expect(quoteTsvCell("plain")).toBe("plain");
        expect(quoteTsvCell("a\tb")).toBe('"a\tb"');
        expect(quoteTsvCell("a\nb")).toBe('"a\nb"');
        expect(quoteTsvCell('say "hi"')).toBe('"say ""hi"""');
    });

    it("quotes special cells when serializing a selection", () => {
        const values: Record<string, string> = {
            "row-1:plant": "Black\tcurrant",
            "row-1:status": 'The "best"',
            "row-2:plant": "Line one\nLine two",
            "row-2:status": "ok",
        };
        const text = copyTextForSelection({
            selection: { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 },
            locations: [{ rowId: "row-1", columnId: "plant" }],
            rows: [{ id: "row-1" }, { id: "row-2" }],
            columns: [{ id: "plant" }, { id: "status" }],
            getCellText: location => values[`${location.rowId}:${location.columnId}`] ?? "",
        });

        expect(text).toBe('"Black\tcurrant"\t"The ""best"""\n"Line one\nLine two"\tok');
        expect(parseTsv(text)).toEqual([
            ["Black\tcurrant", 'The "best"'],
            ["Line one\nLine two", "ok"],
        ]);
    });

    it("quotes a single copied cell and parses plain, empty and mid-field quotes literally", () => {
        expect(
            copyTextForSelection({
                selection: null,
                locations: [{ rowId: "row-1", columnId: "plant" }],
                rows: [{ id: "row-1" }],
                columns: [{ id: "plant" }],
                getCellText: () => "a\tb",
            })
        ).toBe('"a\tb"');
        expect(parseTsv("a\tb\nc\t")).toEqual([
            ["a", "b"],
            ["c", ""],
        ]);
        expect(parseTsv('5" pot\tx')).toEqual([['5" pot', "x"]]);
        expect(parseTsv('"unterminated\tcell')).toEqual([["unterminated\tcell"]]);
        expect(parseTsv("")).toEqual([[""]]);
    });
});

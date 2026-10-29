import { describe, expect, it } from "vitest";

import {
    buildFillChanges,
    buildPasteChanges,
    clampFillBoundsToEditableTargets,
    hasEditableCellsInBounds,
} from "./violet-data-grid-fill";

const columns = [{ id: "plant" }, { id: "status" }, { id: "dtm" }];

const rows = [
    {
        id: "row-1",
        cells: [
            { editable: true, text: "Black currant", rawValue: "Black currant", editor: "text" },
            { editable: false, text: "Established", rawValue: "Established", editor: "custom" },
            { editable: true, text: "365", rawValue: 365, editor: "number" },
        ],
    },
    {
        id: "row-2",
        cells: [
            { editable: true, text: "Romanesco", rawValue: "Romanesco", editor: "text" },
            { editable: false, text: "In bed", rawValue: "In bed", editor: "custom" },
            { editable: true, text: "80", rawValue: 80, editor: "number" },
        ],
    },
];

describe("violet-data-grid-fill helpers", () => {
    it("detects whether a bounds region contains editable cells", () => {
        expect(
            hasEditableCellsInBounds(rows, {
                rowStart: 0,
                rowEnd: 1,
                columnStart: 1,
                columnEnd: 1,
            })
        ).toBe(false);

        expect(
            hasEditableCellsInBounds(rows, {
                rowStart: 0,
                rowEnd: 1,
                columnStart: 2,
                columnEnd: 2,
            })
        ).toBe(true);
    });

    it("clamps fill expansion at locked boundaries", () => {
        expect(
            clampFillBoundsToEditableTargets(
                rows,
                {
                    rowStart: 0,
                    rowEnd: 1,
                    columnStart: 0,
                    columnEnd: 2,
                },
                {
                    rowStart: 0,
                    rowEnd: 1,
                    columnStart: 2,
                    columnEnd: 2,
                }
            )
        ).toEqual({
            rowStart: 0,
            rowEnd: 1,
            columnStart: 2,
            columnEnd: 2,
        });
    });

    it("builds paste changes and skips locked cells", () => {
        const changes = buildPasteChanges({
            text: "42",
            originIndices: { rowIndex: 0, columnIndex: 0 },
            selection: {
                rowStart: 0,
                rowEnd: 1,
                columnStart: 0,
                columnEnd: 1,
            },
            selectedLocations: [
                { rowId: "row-1", columnId: "plant" },
                { rowId: "row-1", columnId: "status" },
                { rowId: "row-2", columnId: "plant" },
                { rowId: "row-2", columnId: "status" },
            ],
            rows,
            columns,
            normalizeValue: (_cell, value) => value,
        });

        expect(changes).toEqual([
            { rowId: "row-1", columnId: "plant", value: "42" },
            { rowId: "row-2", columnId: "plant", value: "42" },
        ]);
    });

    it("builds fill changes by repeating the source pattern and skipping locked targets", () => {
        const changes = buildFillChanges({
            rows,
            columns,
            sourceBounds: {
                rowStart: 0,
                rowEnd: 0,
                columnStart: 2,
                columnEnd: 2,
            },
            targetBounds: {
                rowStart: 0,
                rowEnd: 1,
                columnStart: 2,
                columnEnd: 2,
            },
            normalizeValue: (_cell, value) => Number(value),
        });

        expect(changes).toEqual([{ rowId: "row-2", columnId: "dtm", value: 365 }]);
    });

    describe("reverse fills repeat the source pattern", () => {
        const cell = (value: string) => ({ editable: true, text: value, rawValue: value, editor: "text" });
        const identity = (_cell: unknown, value: string) => value;
        const sources = [["A"], ["A", "B"], ["A", "B", "C"]];

        for (const source of sources) {
            const size = source.length;
            const total = size + 7;
            // Targets hold "T"; the selected source sits at the end (down/right of the fill direction).
            const values = Array.from({ length: total }, (_, i) =>
                i >= total - size ? source[i - (total - size)] : "T",
            );
            const expected = Array.from({ length: total - size }, (_, i) => {
                const offset = i - (total - size);
                return source[((offset % size) + size) % size];
            });

            it(`fills upward from a ${size}-cell source`, () => {
                const changes = buildFillChanges({
                    rows: values.map((v, i) => ({ id: `r${i}`, cells: [cell(v)] })),
                    columns: [{ id: "c0" }],
                    sourceBounds: { rowStart: total - size, rowEnd: total - 1, columnStart: 0, columnEnd: 0 },
                    targetBounds: { rowStart: 0, rowEnd: total - 1, columnStart: 0, columnEnd: 0 },
                    normalizeValue: identity,
                });
                expect(changes.map((change) => change.value)).toEqual(expected);
                expect(changes.map((change) => change.rowId)).toEqual(expected.map((_, i) => `r${i}`));
            });

            it(`fills leftward from a ${size}-cell source`, () => {
                const changes = buildFillChanges({
                    rows: [{ id: "r0", cells: values.map(cell) }],
                    columns: values.map((_, i) => ({ id: `c${i}` })),
                    sourceBounds: { rowStart: 0, rowEnd: 0, columnStart: total - size, columnEnd: total - 1 },
                    targetBounds: { rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: total - 1 },
                    normalizeValue: identity,
                });
                expect(changes.map((change) => change.value)).toEqual(expected);
                expect(changes.map((change) => change.columnId)).toEqual(expected.map((_, i) => `c${i}`));
            });
        }

        it("matches the issue example: A,B dragged up over Target yields B", () => {
            const changes = buildFillChanges({
                rows: ["Target", "A", "B"].map((v, i) => ({ id: `r${i}`, cells: [cell(v)] })),
                columns: [{ id: "c0" }],
                sourceBounds: { rowStart: 1, rowEnd: 2, columnStart: 0, columnEnd: 0 },
                targetBounds: { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 0 },
                normalizeValue: identity,
            });
            expect(changes).toEqual([{ rowId: "r0", columnId: "c0", value: "B" }]);
        });
    });

    it("parses quoted tab-separated cells when mapping pasted text", () => {
        const changes = buildPasteChanges({
            text: '"Black\tcurrant"\t"Estab ""lished"""\t1\n"Roma\nnesco"\tx\t2',
            originIndices: { rowIndex: 0, columnIndex: 0 },
            selection: null,
            selectedLocations: [],
            rows,
            columns,
            normalizeValue: (_cell, value) => value,
        });

        expect(changes).toEqual([
            { rowId: "row-1", columnId: "plant", value: "Black\tcurrant" },
            { rowId: "row-1", columnId: "dtm", value: "1" },
            { rowId: "row-2", columnId: "plant", value: "Roma\nnesco" },
            { rowId: "row-2", columnId: "dtm", value: "2" },
        ]);
    });
});

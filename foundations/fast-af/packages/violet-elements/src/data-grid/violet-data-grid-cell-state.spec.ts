import { describe, expect, it } from "vitest";

import {
    isCellSelected,
    isFillPreviewCell,
    rangeEdgeForCell,
    resolveCellPartText,
} from "./violet-data-grid-cell-state";

const selection = {
    rowStart: 1,
    rowEnd: 2,
    columnStart: 3,
    columnEnd: 4,
};

describe("violet-data-grid-cell-state helpers", () => {
    it("detects whether a cell falls inside the selected range", () => {
        expect(isCellSelected(selection, { rowIndex: 1, columnIndex: 4 })).toBe(true);
        expect(isCellSelected(selection, { rowIndex: 0, columnIndex: 4 })).toBe(false);
    });

    it("derives the visible range edges for a selected cell", () => {
        expect(rangeEdgeForCell(selection, { rowIndex: 1, columnIndex: 3 })).toBe("top left");
        expect(rangeEdgeForCell(selection, { rowIndex: 2, columnIndex: 4 })).toBe("bottom right");
        expect(rangeEdgeForCell(selection, { rowIndex: 1, columnIndex: 4 })).toBe("top right");
    });

    it("treats preview cells outside the source bounds as fill preview", () => {
        expect(
            isFillPreviewCell(
                { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1 },
                { rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: 1 },
                { rowIndex: 1, columnIndex: 1 }
            )
        ).toBe(true);

        expect(
            isFillPreviewCell(
                { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1 },
                { rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: 1 },
                { rowIndex: 0, columnIndex: 1 }
            )
        ).toBe(false);
    });

    it("composes cell part text from the active state flags", () => {
        expect(
            resolveCellPartText("cell", {
                selected: true,
                rangeEdge: "top",
                fillPreview: true,
                active: true,
                editing: false,
            })
        ).toBe("cell selected-cell selected-range-edge fill-preview-cell active-cell");
    });
});

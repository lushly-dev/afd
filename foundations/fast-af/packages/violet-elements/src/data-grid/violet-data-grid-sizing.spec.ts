import { describe, expect, it } from "vitest";

import {
    autosizedColumnWidth,
    cssLengthToPixels,
    inlinePadding,
    minimumColumnWidth,
    resolvedColumnWidth,
} from "./violet-data-grid-sizing";

function makeCell(rectWidth: number, padding = "8px"): HTMLTableCellElement {
    const cell = document.createElement("th");
    cell.style.paddingInlineStart = padding;
    cell.style.paddingInlineEnd = padding;
    cell.getBoundingClientRect = () =>
        ({
            width: rectWidth,
            left: 0,
            top: 0,
            right: rectWidth,
            bottom: 40,
            height: 40,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;
    return cell;
}

describe("violet-data-grid-sizing helpers", () => {
    it("resolves stored and source column widths", () => {
        expect(
            resolvedColumnWidth("status", { status: "14rem" }, [{ id: "status", width: "12rem" }])
        ).toBe("14rem");
        expect(resolvedColumnWidth("status", null, [{ id: "status", width: "12rem" }])).toBe("12rem");
    });

    it("measures inline padding and minimum width", () => {
        const cell = makeCell(120, "10px");
        document.body.append(cell);
        expect(inlinePadding(cell)).toBeGreaterThanOrEqual(20);
        expect(minimumColumnWidth(cell)).toBeGreaterThanOrEqual(72);
        cell.remove();
    });

    it("converts px css lengths directly", () => {
        expect(cssLengthToPixels("88px")).toBe(88);
    });

    it("computes an autosized width using header and sampled cells", () => {
        const headerCell = makeCell(0);
        const sampleCell = makeCell(0);

        const width = autosizedColumnWidth({
            columnId: "status",
            column: {
                id: "status",
                label: "Status",
                sortable: true,
            },
            rows: [{ id: "row-1" }],
            headerCell,
            sampleCell,
            getCellText: () => "Established",
            sampleRows: [{ id: "row-1" }],
            measurementCanvas: document.createElement("canvas"),
        });

        expect(width).toBeGreaterThanOrEqual(72);
    });
});

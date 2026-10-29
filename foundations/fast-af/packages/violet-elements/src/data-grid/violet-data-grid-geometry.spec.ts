import { describe, expect, it } from "vitest";

import {
    locationFromCellElement,
    nearestLocationForPoint,
    preferredAxisForPoint,
    rectFromCellPair,
} from "./violet-data-grid-geometry";

function makeCell(
    rowId: string,
    columnId: string,
    rect: { left: number; top: number; right: number; bottom: number }
): HTMLTableCellElement {
    const cell = document.createElement("td");
    cell.dataset.rowId = rowId;
    cell.dataset.columnId = columnId;
    cell.getBoundingClientRect = () =>
        ({
            ...rect,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            x: rect.left,
            y: rect.top,
            toJSON: () => ({}),
        }) as DOMRect;
    return cell;
}

describe("violet-data-grid-geometry helpers", () => {
    it("reads a location from a cell element", () => {
        const cell = makeCell("row-1", "status", {
            left: 0,
            top: 0,
            right: 100,
            bottom: 40,
        });

        expect(locationFromCellElement(cell)).toEqual({
            rowId: "row-1",
            columnId: "status",
        });
    });

    it("finds the nearest eligible cell for a point", () => {
        const leftCell = makeCell("row-1", "plant", {
            left: 0,
            top: 0,
            right: 100,
            bottom: 40,
        });
        const rightCell = makeCell("row-1", "status", {
            left: 100,
            top: 0,
            right: 200,
            bottom: 40,
        });

        expect(
            nearestLocationForPoint({
                cells: [leftCell, rightCell],
                clientX: 180,
                clientY: 20,
            })
        ).toEqual({
            rowId: "row-1",
            columnId: "status",
        });

        expect(
            nearestLocationForPoint({
                cells: [leftCell, rightCell],
                clientX: 180,
                clientY: 20,
                predicate: location => location.columnId === "plant",
            })
        ).toEqual({
            rowId: "row-1",
            columnId: "plant",
        });
    });

    it("derives the dominant drag axis from the source rect", () => {
        const rect = new DOMRect(100, 100, 80, 40);

        expect(preferredAxisForPoint(250, 110, rect)).toBe("horizontal");
        expect(preferredAxisForPoint(120, 200, rect)).toBe("vertical");
        expect(preferredAxisForPoint(120, 120, rect)).toBeNull();
    });

    it("builds a union rect from two cells", () => {
        const startCell = makeCell("row-1", "plant", {
            left: 10,
            top: 20,
            right: 60,
            bottom: 50,
        });
        const endCell = makeCell("row-2", "status", {
            left: 60,
            top: 50,
            right: 120,
            bottom: 90,
        });

        expect(rectFromCellPair(startCell, endCell)).toEqual(new DOMRect(10, 20, 110, 70));
    });
});

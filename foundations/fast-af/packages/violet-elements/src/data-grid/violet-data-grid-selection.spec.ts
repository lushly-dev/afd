import { describe, expect, it } from "vitest";

import {
    boundsForRange,
    locationWithinBounds,
    nextTabLocation,
    selectedLocations,
} from "./violet-data-grid-selection";

const rows = [{ id: "row-1" }, { id: "row-2" }];
const columns = [{ id: "plant" }, { id: "status" }];

describe("violet-data-grid-selection helpers", () => {
    it("normalizes bounds regardless of anchor/focus order", () => {
        expect(
            boundsForRange(rows, columns, {
                anchor: { rowId: "row-2", columnId: "status" },
                focus: { rowId: "row-1", columnId: "plant" },
            })
        ).toEqual({
            rowStart: 0,
            rowEnd: 1,
            columnStart: 0,
            columnEnd: 1,
        });
    });

    it("returns the active cell when there is no range selection", () => {
        expect(selectedLocations(rows, columns, null, { rowId: "row-2", columnId: "status" })).toEqual([
            { rowId: "row-2", columnId: "status" },
        ]);
    });

    it("walks tab order in row-major sequence", () => {
        expect(nextTabLocation(rows, columns, { rowId: "row-1", columnId: "plant" }, 1)).toEqual({
            rowId: "row-1",
            columnId: "status",
        });

        expect(nextTabLocation(rows, columns, { rowId: "row-1", columnId: "status" }, 1)).toEqual({
            rowId: "row-2",
            columnId: "plant",
        });

        expect(nextTabLocation(rows, columns, { rowId: "row-1", columnId: "plant" }, -1)).toBeNull();
    });

    it("checks whether a location falls within selection bounds", () => {
        const bounds = {
            rowStart: 0,
            rowEnd: 1,
            columnStart: 0,
            columnEnd: 0,
        };

        expect(locationWithinBounds(rows, columns, { rowId: "row-2", columnId: "plant" }, bounds)).toBe(true);
        expect(locationWithinBounds(rows, columns, { rowId: "row-2", columnId: "status" }, bounds)).toBe(false);
    });
});

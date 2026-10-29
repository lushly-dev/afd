import { describe, expect, it } from "vitest";

import {
    createCellSelection,
    firstCellLocation,
    nextCellLocationForKey,
} from "./violet-data-grid-navigation";

const rows = [{ id: "row-1" }, { id: "row-2" }, { id: "row-3" }];
const columns = [{ id: "plant" }, { id: "status" }, { id: "dtm" }];

describe("violet-data-grid-navigation helpers", () => {
    it("resolves the first available cell location", () => {
        expect(firstCellLocation(rows, columns)).toEqual({
            rowId: "row-1",
            columnId: "plant",
        });

        expect(firstCellLocation([], columns)).toBeNull();
    });

    it("creates rectangular selections only when anchor and focus differ", () => {
        expect(
            createCellSelection(
                { rowId: "row-1", columnId: "plant" },
                { rowId: "row-1", columnId: "plant" }
            )
        ).toBeNull();

        expect(
            createCellSelection(
                { rowId: "row-1", columnId: "plant" },
                { rowId: "row-2", columnId: "status" }
            )
        ).toEqual({
            anchor: { rowId: "row-1", columnId: "plant" },
            focus: { rowId: "row-2", columnId: "status" },
        });
    });

    it("moves around the grid with arrow, home, and end keys", () => {
        expect(
            nextCellLocationForKey({
                rows,
                columns,
                activeCell: { rowId: "row-2", columnId: "status" },
                key: "ArrowRight",
                metaKey: false,
            })
        ).toEqual({
            rowId: "row-2",
            columnId: "dtm",
        });

        expect(
            nextCellLocationForKey({
                rows,
                columns,
                activeCell: { rowId: "row-2", columnId: "status" },
                key: "Home",
                metaKey: false,
            })
        ).toEqual({
            rowId: "row-2",
            columnId: "plant",
        });

        expect(
            nextCellLocationForKey({
                rows,
                columns,
                activeCell: { rowId: "row-2", columnId: "status" },
                key: "End",
                metaKey: true,
            })
        ).toEqual({
            rowId: "row-3",
            columnId: "dtm",
        });
    });

    it("falls back to the first cell when the current location is no longer valid", () => {
        expect(
            nextCellLocationForKey({
                rows,
                columns,
                activeCell: { rowId: "missing", columnId: "status" },
                key: "ArrowDown",
                metaKey: false,
            })
        ).toEqual({
            rowId: "row-1",
            columnId: "plant",
        });
    });
});

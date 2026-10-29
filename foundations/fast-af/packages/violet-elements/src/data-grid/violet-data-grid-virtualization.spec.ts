import { describe, expect, it } from "vitest";

import { buildRenderedRows, buildVirtualizerUpdateOptions } from "./violet-data-grid-virtualization";

describe("violet-data-grid-virtualization helpers", () => {
    it("builds non-virtual rendered rows from the full presented row set", () => {
        const rows = [{ id: "row-1" }, { id: "row-2" }];

        const result = buildRenderedRows({
            virtualize: false,
            rows,
            estimatedRowHeight: 44,
            virtualItems: [],
            totalSize: 0,
        });

        expect(result.virtualPaddingStart).toBe(0);
        expect(result.virtualPaddingEnd).toBe(0);
        expect(result.renderedRows.map(row => row.row.id)).toEqual(["row-1", "row-2"]);
        expect(result.renderedRows.map(row => row.item.start)).toEqual([0, 44]);
    });

    it("builds rendered rows and padding from virtual items", () => {
        const rows = [{ id: "row-1" }, { id: "row-2" }, { id: "row-3" }];

        const result = buildRenderedRows({
            virtualize: true,
            rows,
            estimatedRowHeight: 44,
            virtualItems: [
                {
                    key: "row-2",
                    index: 1,
                    start: 44,
                    end: 88,
                    size: 44,
                    lane: 0,
                },
                {
                    key: "row-3",
                    index: 2,
                    start: 88,
                    end: 132,
                    size: 44,
                    lane: 0,
                },
            ],
            totalSize: 176,
        });

        expect(result.renderedRows.map(row => row.row.id)).toEqual(["row-2", "row-3"]);
        expect(result.virtualPaddingStart).toBe(44);
        expect(result.virtualPaddingEnd).toBe(44);
    });

    it("builds stable virtualizer update options from grid state", () => {
        const rows = [{ id: "row-1" }, { id: "row-2" }];
        const options = buildVirtualizerUpdateOptions({
            rows,
            estimatedRowHeight: 32,
            overscanCount: 6,
            virtualize: true,
        });

        expect(options.count).toBe(2);
        expect(options.estimateSize()).toBe(32);
        expect(options.overscan).toBe(6);
        expect(options.enabled).toBe(true);
        expect(options.getItemKey(1)).toBe("row-2");
        expect(options.getItemKey(9)).toBe(9);
    });
});

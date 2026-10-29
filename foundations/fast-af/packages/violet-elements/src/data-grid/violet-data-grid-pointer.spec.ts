import { describe, expect, it } from "vitest";

import {
    beginFillDrag,
    beginPointerSelection,
    clearedFillSession,
    clearedPointerSelectionSession,
    isFillPointerEventForSession,
    isPointerSelectionEventForSession,
    markPointerSelectionMoved,
    pointerSelectionSuppressesNextClick,
} from "./violet-data-grid-pointer";

describe("violet-data-grid-pointer helpers", () => {
    it("starts pointer selection sessions from an anchor cell", () => {
        expect(beginPointerSelection(11, { rowId: "row-1", columnId: "plant" })).toEqual({
            anchor: { rowId: "row-1", columnId: "plant" },
            pointerId: 11,
            moved: false,
        });
    });

    it("matches pointer selection events and tracks moved state", () => {
        const session = beginPointerSelection(4, { rowId: "row-2", columnId: "status" });

        expect(isPointerSelectionEventForSession(session, 4)).toBe(true);
        expect(isPointerSelectionEventForSession(session, 8)).toBe(false);
        expect(pointerSelectionSuppressesNextClick(session, true)).toBe(false);
        expect(pointerSelectionSuppressesNextClick(markPointerSelectionMoved(session), true)).toBe(true);
    });

    it("clears pointer selection sessions back to the inert state", () => {
        expect(clearedPointerSelectionSession()).toEqual({
            anchor: null,
            pointerId: null,
            moved: false,
        });
    });

    it("starts fill sessions only when a source range exists", () => {
        expect(beginFillDrag(15, null)).toBeNull();
        expect(
            beginFillDrag(15, {
                anchor: { rowId: "row-1", columnId: "dtm" },
                focus: { rowId: "row-2", columnId: "dtm" },
            })
        ).toEqual({
            pointerId: 15,
            sourceRange: {
                anchor: { rowId: "row-1", columnId: "dtm" },
                focus: { rowId: "row-2", columnId: "dtm" },
            },
        });
    });

    it("matches fill events and clears fill sessions", () => {
        const session = beginFillDrag(22, {
            anchor: { rowId: "row-1", columnId: "plant" },
            focus: { rowId: "row-1", columnId: "status" },
        });

        expect(session && isFillPointerEventForSession(session, 22)).toBe(true);
        expect(session && isFillPointerEventForSession(session, 23)).toBe(false);
        expect(clearedFillSession()).toEqual({
            pointerId: null,
            sourceRange: null,
        });
    });
});

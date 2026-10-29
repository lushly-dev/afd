import { describe, expect, it } from "vitest";

import {
    beginColumnResize,
    clearedColumnResizeSession,
    isColumnResizeEventForSession,
    resizedColumnWidth,
} from "./violet-data-grid-resize";

describe("violet-data-grid-resize helpers", () => {
    it("starts resize sessions only for the primary pointer button", () => {
        expect(
            beginColumnResize({
                button: 0,
                pointerId: 12,
                columnId: "status",
                clientX: 240,
                startWidth: 180,
            })
        ).toEqual({
            pointerId: 12,
            columnId: "status",
            startX: 240,
            startWidth: 180,
        });

        expect(
            beginColumnResize({
                button: 1,
                pointerId: 12,
                columnId: "status",
                clientX: 240,
                startWidth: 180,
            })
        ).toBeNull();
    });

    it("matches pointer events against the active resize session", () => {
        const session = {
            pointerId: 7,
            columnId: "dtm",
            startX: 0,
            startWidth: 120,
        };

        expect(isColumnResizeEventForSession(session, 7)).toBe(true);
        expect(isColumnResizeEventForSession(session, 8)).toBe(false);
        expect(
            isColumnResizeEventForSession(
                {
                    pointerId: null,
                    columnId: null,
                    startX: 0,
                    startWidth: 0,
                },
                7
            )
        ).toBe(false);
    });

    it("computes clamped resized widths from pointer movement", () => {
        const session = {
            pointerId: 9,
            columnId: "plant",
            startX: 100,
            startWidth: 180,
        };

        expect(
            resizedColumnWidth({
                session,
                clientX: 132,
                minimumWidth: 120,
            })
        ).toBe(212);

        expect(
            resizedColumnWidth({
                session,
                clientX: 10,
                minimumWidth: 120,
            })
        ).toBe(120);
    });

    it("clears resize sessions back to the inert state", () => {
        expect(clearedColumnResizeSession()).toEqual({
            pointerId: null,
            columnId: null,
            startX: 0,
            startWidth: 0,
        });
    });
});

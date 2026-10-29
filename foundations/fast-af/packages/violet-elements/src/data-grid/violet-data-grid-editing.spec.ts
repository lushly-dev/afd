import { describe, expect, it, vi } from "vitest";

import {
    beginEditingState,
    cancelEditingState,
    commitEditingState,
    editorStringValue,
    focusEditorAtEnd,
    seedEditorValue,
} from "./violet-data-grid-editing";

describe("violet-data-grid-editing helpers", () => {
    it("starts editing only for editable non-checkbox cells", () => {
        expect(
            beginEditingState(
                { rowId: "row-1", columnId: "plant" },
                { editable: true, editor: "text" },
                "Black currant"
            )
        ).toEqual({
            editingCell: { rowId: "row-1", columnId: "plant" },
            editingValue: "Black currant",
        });

        expect(
            beginEditingState(
                { rowId: "row-1", columnId: "tracked" },
                { editable: true, editor: "checkbox" },
                "true"
            )
        ).toBeNull();
    });

    it("commits editing into a normalized change detail and clears state", () => {
        const result = commitEditingState({
            editingCell: { rowId: "row-2", columnId: "dtm" },
            editingValue: "80",
            cell: { editor: "number" },
            normalizeValue: (_cell, value) => Number(value),
        });

        expect(result.nextState).toEqual({
            editingCell: null,
            editingValue: "",
        });
        expect(result.detail).toEqual({
            rowId: "row-2",
            columnId: "dtm",
            value: 80,
        });
    });

    it("cancels editing and reports the cancelled location", () => {
        expect(cancelEditingState({ rowId: "row-3", columnId: "status" })).toEqual({
            nextState: {
                editingCell: null,
                editingValue: "",
            },
            cancelledCell: {
                rowId: "row-3",
                columnId: "status",
            },
        });
    });

    it("reads string editor values safely", () => {
        expect(editorStringValue({ value: "Harvesting" })).toBe("Harvesting");
        expect(editorStringValue({ value: undefined })).toBe("");
    });

    it("focuses editors and places the caret at the end", () => {
        const input = document.createElement("input");
        input.value = "Romanesco";
        const focusSpy = vi.spyOn(input, "focus");

        focusEditorAtEnd(input);

        expect(focusSpy).toHaveBeenCalled();
        expect(input.selectionStart).toBe(input.value.length);
        expect(input.selectionEnd).toBe(input.value.length);
    });
    // Regression: the editor template used to bind `:value` reactively, which
    // made the input controlled — every render pass wrote the model back over
    // the user's keystrokes and cell editing silently refused all input. The
    // value is now seeded imperatively and the editor owns it while open.
    it("seeds the editor value imperatively", () => {
        const input = document.createElement("input");
        seedEditorValue(input, "Cherokee Purple");
        expect(input.value).toBe("Cherokee Purple");

        // A later render must not be able to reach back in and change it.
        input.value = "user typed this";
        expect(input.value).toBe("user typed this");
    });

    it("ignores a missing editor", () => {
        expect(() => seedEditorValue(null, "anything")).not.toThrow();
    });
});

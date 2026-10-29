import { describe, expect, it } from "vitest";

import {
    isCheckboxCellTarget,
    isEditorElement,
    isFillHandleTarget,
    isInteractiveCellWidgetTarget,
} from "./violet-data-grid-targets";

describe("violet-data-grid-target helpers", () => {
    it("detects editor elements", () => {
        const input = document.createElement("input");
        input.className = "cell-editor";

        expect(isEditorElement(input)).toBe(true);
        expect(isEditorElement(document.createElement("div"))).toBe(false);
    });

    it("detects interactive widget targets", () => {
        const wrapper = document.createElement("span");
        wrapper.setAttribute("data-cell-widget", "checkbox");
        const child = document.createElement("span");
        wrapper.append(child);

        expect(isInteractiveCellWidgetTarget(child)).toBe(true);
    });

    it("detects unmarked native interactive targets and their descendants", () => {
        const button = document.createElement("button");
        const copy = document.createElement("span");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        copy.append(icon);
        button.append(copy);
        const input = document.createElement("input");
        const link = document.createElement("a");
        link.href = "/plants";

        expect(isInteractiveCellWidgetTarget(copy)).toBe(true);
        expect(isInteractiveCellWidgetTarget(icon)).toBe(true);
        expect(isInteractiveCellWidgetTarget(input)).toBe(true);
        expect(isInteractiveCellWidgetTarget(link)).toBe(true);
        expect(isInteractiveCellWidgetTarget(document.createElement("span"))).toBe(false);
        expect(isInteractiveCellWidgetTarget(null)).toBe(false);
        expect(isInteractiveCellWidgetTarget(window)).toBe(false);
        expect(isInteractiveCellWidgetTarget(document)).toBe(false);
    });

    it("detects checkbox widget targets", () => {
        const checkbox = document.createElement("violet-checkbox");
        checkbox.setAttribute("data-cell-widget", "checkbox");

        expect(isCheckboxCellTarget(checkbox)).toBe(true);
        expect(isCheckboxCellTarget(document.createElement("div"))).toBe(false);
    });

    it("detects fill handle targets", () => {
        const handle = document.createElement("span");
        handle.setAttribute("data-fill-handle", "true");

        expect(isFillHandleTarget(handle)).toBe(true);
        expect(isFillHandleTarget(document.createElement("span"))).toBe(false);
    });
});

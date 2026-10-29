import { describe, expect, it } from "vitest";

import { safeCssValue } from "./violet-data-grid-css";

describe("violet-data-grid-css safeCssValue", () => {
    it("accepts values that are valid for the property", () => {
        expect(safeCssValue("width", " 12rem ")).toBe("12rem");
        expect(safeCssValue("width", "calc(100% - 2rem)")).toBe("calc(100% - 2rem)");
        expect(safeCssValue("width", "var(--violet-data-grid-default-column-width, 12rem)")).toBe(
            "var(--violet-data-grid-default-column-width, 12rem)",
        );
        expect(safeCssValue("color", "#fff")).toBe("#fff");
        expect(safeCssValue("background", "color-mix(in srgb, red 50%, white)")).toBe(
            "color-mix(in srgb, red 50%, white)",
        );
    });

    it("rejects values that are invalid for the property", () => {
        expect(safeCssValue("width", "not-a-width")).toBeUndefined();
        expect(safeCssValue("color", "12rem")).toBeUndefined();
        expect(safeCssValue("width", "")).toBeUndefined();
        expect(safeCssValue("width", undefined)).toBeUndefined();
        expect(safeCssValue("width", 12)).toBeUndefined();
    });

    it("rejects declaration and rule injection even when the leading value is valid", () => {
        expect(safeCssValue("width", "10px;background:red")).toBeUndefined();
        expect(safeCssValue("width", "10px}body{display:none")).toBeUndefined();
        expect(safeCssValue("background", "url(https://example.com/track.png)")).toBeUndefined();
        expect(safeCssValue("background", "red /* comment */")).toBeUndefined();
        expect(safeCssValue("color", "red\\3b background:blue")).toBeUndefined();
    });
});

import { describe, expect, it } from "vitest";

import {
    booleanCellValue,
    editStringForRawValue,
    normalizedEditingValue,
    opensOnSingleActiveClick,
  resolveEditingValue,
} from "./violet-data-grid-values";

describe("violet-data-grid-values helpers", () => {
    it("creates edit strings from raw values", () => {
        expect(editStringForRawValue(null)).toBe("");
        expect(editStringForRawValue(undefined)).toBe("");
        expect(editStringForRawValue(365)).toBe("365");
    });

    it("normalizes checkbox-like values to booleans", () => {
        expect(booleanCellValue(true)).toBe(true);
        expect(booleanCellValue(0)).toBe(false);
        expect(booleanCellValue(" yes ")).toBe(true);
        expect(booleanCellValue("off")).toBe(false);
    expect(booleanCellValue("false")).toBe(false);
    expect(booleanCellValue(null)).toBe(false);
    expect(booleanCellValue("mixed")).toBe(false);
    expect(booleanCellValue({ checked: true })).toBe(false);
    });

    it("normalizes number editor values and preserves non-numeric text", () => {
        const numberCell = {
            editor: "number" as const,
            rowData: {},
        };

        expect(normalizedEditingValue(numberCell, "80")).toBe(80);
        expect(normalizedEditingValue(numberCell, "  ")).toBeNull();
        expect(normalizedEditingValue(numberCell, "08a")).toBe("08a");
    });

    it("uses custom parse functions before editor defaults", () => {
        const parsed = normalizedEditingValue(
            {
                editor: "text" as const,
                rowData: { prefix: "row" },
                parse: (value, row) => `${row.prefix}:${value}`,
            },
      "value",
        );

        expect(parsed).toBe("row:value");
    });

  it("preserves custom checkbox parsers", () => {
    const parsed = normalizedEditingValue(
      {
        editor: "checkbox" as const,
        rowData: { key: "tracked" },
        parse: (value, row) => `${row.key}:${String(value)}`,
      },
      false,
    );

    expect(parsed).toBe("tracked:false");
  });

  it("lets custom number parsers interpret formatted drafts and report validation errors", () => {
    const cell = {
      editor: "number" as const,
      rowData: {},
      parse: (value: unknown) => {
        if (value === "invalid") throw new Error("Use a number followed by days.");
        return Number.parseInt(String(value), 10);
      },
    };
    expect(resolveEditingValue(cell, "80 days")).toEqual({ valid: true, value: 80 });
    expect(resolveEditingValue(cell, "invalid")).toEqual({
      valid: false,
      message: "Use a number followed by days.",
    });
  });

  it("reports invalid number drafts without discarding their text", () => {
    const cell = { editor: "number" as const, rowData: {} };

    expect(resolveEditingValue(cell, "eight days")).toEqual({
      valid: false,
      message: "Enter a valid number.",
    });
    expect(resolveEditingValue(cell, "80")).toEqual({ valid: true, value: 80 });
  });

    it("defines the single-click edit rule for widget editors", () => {
        expect(opensOnSingleActiveClick("text")).toBe(false);
        expect(opensOnSingleActiveClick("number")).toBe(false);
        expect(opensOnSingleActiveClick("select")).toBe(true);
        expect(opensOnSingleActiveClick("custom")).toBe(true);
    });
});

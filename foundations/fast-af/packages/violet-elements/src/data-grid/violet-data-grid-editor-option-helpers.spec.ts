import { describe, expect, it } from "vitest";
import {
  displayOptionForValue,
  filterEditorOptions,
  optionForValue,
  resolveOptionVisuals,
} from "./violet-data-grid-editor-option-helpers";

describe("data grid editor option helpers", () => {
  const options = [
    { value: "bed-1", label: "Cedar", description: "North field", keywords: ["perennial"] },
    { value: "bed-2", label: "Willow" },
  ];

  it("searches labels, values, descriptions, and keywords case-insensitively", () => {
    for (const query of ["CEDAR", " bed-1 ", "north", "perennial"]) {
      expect(filterEditorOptions(options, query)).toEqual([options[0]]);
    }
    expect(filterEditorOptions(options, " ")).toBe(options);
    expect(filterEditorOptions(options, "missing")).toEqual([]);
  });

  it("preserves labels for unresolved values without modifying candidate options", () => {
    expect(optionForValue(options, "bed-1")).toBe(options[0]);
    expect(optionForValue(options, "missing")).toBeNull();
    expect(displayOptionForValue(options, "missing")).toEqual({
      value: "missing",
      label: "missing",
    });
    expect(options).toHaveLength(2);
  });

  it("uses explicit visuals before tones with semantic fallback values", () => {
    expect(
      resolveOptionVisuals({ value: "x", label: "X", tone: "blue", foreground: "red" }),
    ).toEqual({
      background: "var(--_surface-subtle)",
      foreground: "red",
      borderColor: "transparent",
    });
    expect(resolveOptionVisuals({ value: "x", label: "X" }).foreground).toBe(
      "var(--_text-primary)",
    );
  });
});

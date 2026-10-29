import { describe, expect, it } from "vitest";

import * as violet from "./index";

describe("violet-elements barrel", () => {
    it("registers every reusable element, including the range slider", () => {
        expect(violet.VioletRangeSlider).toBeDefined();
        expect(customElements.get("violet-range-slider")).toBe(violet.VioletRangeSlider);
        expect(customElements.get("violet-slider")).toBe(violet.VioletSlider);
    });
});

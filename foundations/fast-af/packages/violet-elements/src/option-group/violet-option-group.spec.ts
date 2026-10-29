import { afterEach, describe, expect, it } from "vitest";

import "../listbox/violet-listbox";
import "../option/violet-option";
import "./violet-option-group";
import type { VioletOption } from "../option/violet-option";
import type { VioletOptionGroup } from "./violet-option-group";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

describe("violet-option-group", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a labelled group inside a listbox context", async () => {
        const listbox = document.createElement("violet-listbox");
        const group = document.createElement("violet-option-group") as VioletOptionGroup;
        const option = document.createElement("violet-option") as VioletOption;

        group.label = "Current suppliers";
        option.value = "regional";
        option.textContent = "Regional catalog";
        group.append(option);
        listbox.append(group);
        document.body.append(listbox);

        await customElements.whenDefined("violet-option-group");
        await nextFrame();

        expect(group.getAttribute("label")).toBe("Current suppliers");
        expect(group.querySelectorAll("violet-option")).toHaveLength(1);
    });
});

import { afterEach, describe, expect, it } from "vitest";

import "../option-group/violet-option-group";
import "../option/violet-option";
import "./violet-listbox";
import type { VioletListbox } from "./violet-listbox";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createOption(label: string, value: string, disabled = false): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;
    if (disabled) {
        option.setAttribute("disabled", "");
    }
    return option;
}

function createGroup(
    label: string,
    options: Array<{ label: string; value: string; disabled?: boolean }>,
    disabled = false
): HTMLElement {
    const group = document.createElement("violet-option-group");
    group.setAttribute("label", label);
    if (disabled) {
        group.setAttribute("disabled", "");
    }

    for (const option of options) {
        group.append(createOption(option.label, option.value, option.disabled ?? false));
    }

    return group;
}

async function renderListbox(): Promise<VioletListbox> {
    document.body.innerHTML = "";
    const listbox = document.createElement("violet-listbox") as VioletListbox;
    listbox.value = "direct";
    listbox.append(
        createOption("Broadcast", "broadcast"),
        createOption("Direct", "direct"),
        createOption("Transplant", "transplant"),
        createOption("Hydro", "hydro", true)
    );
    document.body.append(listbox);
    await customElements.whenDefined("violet-listbox");
    await nextFrame();
    return listbox;
}

describe("violet-listbox", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("syncs selected and active option state from the current value", async () => {
        const listbox = await renderListbox();
        const options = listbox.options;

        expect(listbox.value).toBe("direct");
        expect(options.find(option => option.value === "direct")?.selected).toBe(true);
        expect(options.find(option => option.value === "direct")?.active).toBe(true);
    });

    it("moves active state with the keyboard and commits on enter", async () => {
        const listbox = await renderListbox();
        listbox.handleKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        await nextFrame();

        expect(listbox.activeValue).toBe("transplant");

        listbox.handleKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
        await nextFrame();

        expect(listbox.value).toBe("transplant");
    });

    it("supports multiple selection without collapsing to a single value", async () => {
        const listbox = await renderListbox();
        listbox.multiple = true;
        listbox.selectedValues = ["direct"];
        listbox.activeValue = "transplant";
        listbox.handleKeydown(new KeyboardEvent("keydown", { key: " " }));
        await nextFrame();

        expect(listbox.selectedValues).toEqual(["direct", "transplant"]);
        expect(listbox.options.find(option => option.value === "direct")?.selected).toBe(true);
        expect(listbox.options.find(option => option.value === "transplant")?.selected).toBe(true);
    });

    it("treats options inside a disabled group as unavailable", async () => {
        document.body.innerHTML = "";
        const listbox = document.createElement("violet-listbox") as VioletListbox;
        listbox.value = "regional";
        listbox.append(
            createGroup("Active", [{ label: "Regional", value: "regional" }]),
            createGroup("Archived", [{ label: "Legacy", value: "legacy" }], true)
        );
        document.body.append(listbox);
        await customElements.whenDefined("violet-listbox");
        await nextFrame();

        listbox.selectValue("legacy");
        await nextFrame();

        expect(listbox.value).toBe("regional");
        expect(listbox.options.find(option => option.value === "legacy")?.isDisabled).toBe(true);
    });

    describe("native key handling", () => {
        it("returns true for unhandled keys and false for handled keys", async () => {
            const listbox = await renderListbox();
            const key = (value: string, init: KeyboardEventInit = {}) =>
                new KeyboardEvent("keydown", { key: value, cancelable: true, ...init });

            expect(listbox.handleKeydown(key("Tab"))).toBe(true);
            expect(listbox.handleKeydown(key("a", { ctrlKey: true }))).toBe(true);
            expect(listbox.handleKeydown(key("ArrowDown"))).toBe(false);
        });

        it("does not cancel Tab on a real keydown", async () => {
            const listbox = await renderListbox();
            const control = listbox.shadowRoot?.querySelector('[role="listbox"]') as HTMLElement;
            const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, composed: true });

            control.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
        });
    });
});

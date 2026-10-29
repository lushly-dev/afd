import { afterEach, describe, expect, it } from "vitest";

import "./violet-option";
import { VioletOption } from "./violet-option";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderOption(
    options: {
        text?: string;
        description?: string;
        configure?: (option: VioletOption) => void;
    } = {}
): Promise<VioletOption> {
    document.body.innerHTML = "";

    const option = document.createElement("violet-option") as VioletOption;
    if (options.text !== undefined) {
        option.textContent = options.text;
    }

    if (options.description) {
        const description = document.createElement("span");
        description.slot = "description";
        description.textContent = options.description;
        option.append(description);
    }

    options.configure?.(option);
    document.body.append(option);

    await customElements.whenDefined("violet-option");
    await nextFrame();

    return option;
}

function control(option: VioletOption): HTMLElement {
    const element = option.shadowRoot?.querySelector(".control") as HTMLElement | null;
    if (!element) {
        throw new Error("violet-option did not render its control");
    }
    return element;
}

describe("violet-option", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("exposes option semantics and a generated id when connected", async () => {
        const option = await renderOption({ text: "Apple" });

        expect(option.getAttribute("role")).toBe("option");
        expect(option.id).toBe(option.optionId);
        expect(option.getAttribute("aria-selected")).toBe("false");
        expect(option.getAttribute("aria-disabled")).toBe("false");
    });

    it("keeps an author-provided id", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                el.id = "custom-id";
            },
        });

        expect(option.id).toBe("custom-id");
    });

    it("gives each option a unique id", () => {
        const first = document.createElement("violet-option") as VioletOption;
        const second = document.createElement("violet-option") as VioletOption;

        expect(first.optionId).not.toBe(second.optionId);
    });

    it("derives its value from its text when no value is set", async () => {
        const option = await renderOption({ text: "  Green   apple " });

        expect(option.labelText).toBe("Green apple");
        expect(option.value).toBe("Green apple");
    });

    it("prefers the label attribute for label text and derived value", async () => {
        const option = await renderOption({
            text: "ignored",
            configure: el => {
                el.setAttribute("label", "Explicit label");
            },
        });

        expect(option.labelText).toBe("Explicit label");
        expect(option.value).toBe("Explicit label");
    });

    it("keeps an explicit value", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                el.setAttribute("value", "apple-id");
            },
        });

        expect(option.value).toBe("apple-id");
    });

    it("excludes slotted description text from the label text", async () => {
        const option = await renderOption({ text: "Apple", description: "A red fruit" });

        expect(option.labelText).toBe("Apple");
        expect(option.hasDescription).toBe(true);
    });

    it("reports no description when the slot is empty", async () => {
        const option = await renderOption({ text: "Apple" });

        expect(option.hasDescription).toBe(false);
    });

    it("reflects selected to aria-selected and the control class", async () => {
        const option = await renderOption({ text: "Apple" });

        option.selected = true;
        await nextFrame();

        expect(option.hasAttribute("selected")).toBe(true);
        expect(option.getAttribute("aria-selected")).toBe("true");
        expect(control(option).classList.contains("selected")).toBe(true);

        option.selected = false;
        await nextFrame();

        expect(option.getAttribute("aria-selected")).toBe("false");
        expect(control(option).classList.contains("selected")).toBe(false);
    });

    it("reflects disabled to aria-disabled and the control class", async () => {
        const option = await renderOption({ text: "Apple" });

        option.disabled = true;
        await nextFrame();
        expect(option.hasAttribute("disabled")).toBe(true);
        expect(option.isDisabled).toBe(true);
        expect(option.getAttribute("aria-disabled")).toBe("true");
        expect(control(option).classList.contains("disabled")).toBe(true);

        option.disabled = false;
        await nextFrame();
        expect(option.getAttribute("aria-disabled")).toBe("false");
    });

    it("treats a disabled group as disabled", async () => {
        const option = await renderOption({ text: "Apple" });

        option.groupDisabled = true;

        expect(option.disabled).toBe(false);
        expect(option.isDisabled).toBe(true);
    });

    // The two tests below rely on @observable change callbacks / bindings, which are inert when
    // the vite/esbuild test transform does not apply experimentalDecorators.
    it("reflects group-disabled state to aria-disabled", async () => {
        const option = await renderOption({ text: "Apple" });

        option.groupDisabled = true;
        await nextFrame();

        expect(option.getAttribute("aria-disabled")).toBe("true");
        expect(control(option).classList.contains("disabled")).toBe(true);
    });

    it("marks the control active", async () => {
        const option = await renderOption({ text: "Apple" });

        option.active = true;
        await nextFrame();

        expect(control(option).classList.contains("active")).toBe(true);
    });

    it("emits request-select with its value when clicked", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                el.value = "apple-id";
            },
        });
        const details: Array<{ value: string }> = [];
        option.addEventListener("request-select", event => {
            details.push((event as CustomEvent<{ value: string }>).detail);
        });

        control(option).click();

        expect(details).toEqual([{ value: "apple-id" }]);
    });

    it("does not emit request-select when disabled", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                el.disabled = true;
            },
        });
        let emitted = 0;
        option.addEventListener("request-select", () => {
            emitted += 1;
        });

        control(option).click();

        expect(emitted).toBe(0);
    });

    it("does not emit request-select when its group is disabled", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                el.groupDisabled = true;
            },
        });
        let emitted = 0;
        option.addEventListener("request-select", () => {
            emitted += 1;
        });

        control(option).click();

        expect(emitted).toBe(0);
    });

    it("projects before, default and after slots", async () => {
        const option = await renderOption({
            text: "Apple",
            configure: el => {
                const before = document.createElement("span");
                before.slot = "before";
                const after = document.createElement("span");
                after.slot = "after";
                el.append(before, after);
            },
        });
        const root = option.shadowRoot as ShadowRoot;

        expect((root.querySelector('slot[name="before"]') as HTMLSlotElement).assignedElements()).toHaveLength(1);
        expect((root.querySelector('slot[name="after"]') as HTMLSlotElement).assignedElements()).toHaveLength(1);
        expect((root.querySelector("slot:not([name])") as HTMLSlotElement).assignedNodes()[0]?.textContent).toBe(
            "Apple"
        );
    });
});

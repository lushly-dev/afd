import { afterEach, describe, expect, it } from "vitest";

import "../radio/violet-radio";
import type { VioletRadio } from "../radio/violet-radio";
import "./violet-radio-group";
import type { VioletRadioGroup } from "./violet-radio-group";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

function createRadio(value: string, label: string): VioletRadio {
    const radio = document.createElement("violet-radio") as VioletRadio;
    radio.value = value;
    radio.textContent = label;
    return radio;
}

async function renderGroup(): Promise<{
    form: HTMLFormElement;
    group: VioletRadioGroup;
    radios: VioletRadio[];
}> {
    document.body.innerHTML = "";

    const form = document.createElement("form");
    const group = document.createElement("violet-radio-group") as VioletRadioGroup;
    group.label = "Propagation method";
    group.name = "propagationMethod";
    group.required = true;
    group.value = "broadcast";

    const radios = [
        createRadio("broadcast", "Broadcast sowing"),
        createRadio("direct", "Direct seed"),
        createRadio("transplant", "Tray transplant"),
    ];

    radios.forEach(radio => {
        group.append(radio);
    });
    form.append(group);
    document.body.append(form);

    await customElements.whenDefined("violet-radio-group");
    await nextFrame();

    return { form, group, radios };
}

describe("violet-radio-group", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("selects a clicked radio and writes the selected value to form data", async () => {
        const { form, group, radios } = await renderGroup();

        expect(group.checkValidity()).toBe(true);

        const secondRadioControl = radios[1]?.shadowRoot?.querySelector(".root") as HTMLElement | null;
        secondRadioControl?.click();
        await nextFrame();

        expect(group.value).toBe("direct");
        expect(radios[1]?.checked).toBe(true);
        expect(radios[0]?.checked).toBe(false);
        expect(group.checkValidity()).toBe(true);

        const formData = new FormData(form);
        expect(formData.get("propagationMethod")).toBe("direct");
    });

    it("supports roving keyboard selection and form reset", async () => {
        const { form, group, radios } = await renderGroup();

        radios[0]?.focus();
        expect(document.activeElement).toBe(radios[0]);
        radios[0]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key: "ArrowDown",
            })
        );
        await nextFrame();

        expect(group.value).toBe("direct");
        expect(radios[1]?.tabIndex).toBe(0);
        expect(radios[1]?.checked).toBe(true);
        expect(document.activeElement).toBe(radios[1]);

        form.reset();
        await nextFrame();

        expect(group.value).toBe("broadcast");
        expect(radios[0]?.checked).toBe(true);
        expect(radios[1]?.checked).toBe(false);
    });

    it.each([" ", "Enter"])("focuses and selects an unchecked radio with %s", async key => {
        const { group, radios } = await renderGroup();
        const previousControl = document.createElement("button");
        document.body.prepend(previousControl);

        previousControl.focus();
        expect(document.activeElement).toBe(previousControl);

        radios[1]?.focus();
        expect(document.activeElement).toBe(radios[1]);

        radios[1]?.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key,
            })
        );
        await nextFrame();

        expect(group.value).toBe("direct");
        expect(radios[1]?.checked).toBe(true);
        expect(radios[1]?.tabIndex).toBe(0);
        expect(document.activeElement).toBe(radios[1]);
    });

    it("does not throw when a child radio has not been upgraded yet", async () => {
        const { group, radios } = await renderGroup();
        const pending = createRadio("late", "Late radio");
        // Simulate a radio whose element class has not been applied yet.
        (pending as unknown as { setGroupDisabled?: unknown }).setGroupDisabled = undefined;
        group.append(pending);

        expect(() => group.handleSlotChange()).not.toThrow();
        expect(group.radios).toContain(pending);
        expect(radios[0]?.checked).toBe(true);
    });
});

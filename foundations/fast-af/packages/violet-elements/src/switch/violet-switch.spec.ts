import { afterEach, describe, expect, it } from "vitest";

import "./violet-switch";
import type { VioletSwitch } from "./violet-switch";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderSwitch(options: {
    checked?: boolean;
    inline?: boolean;
    label?: string;
    supporting?: string;
    ariaLabel?: string;
    required?: boolean;
} = {}): Promise<VioletSwitch> {
    document.body.innerHTML = "";

    const element = document.createElement("violet-switch") as VioletSwitch;
    element.checked = options.checked ?? false;
    element.inline = options.inline ?? false;
    element.required = options.required ?? false;
    element.name = "notifications";
    element.value = "enabled";

    if (options.ariaLabel) {
        element.setAttribute("aria-label", options.ariaLabel);
    }

    if (options.label) {
        element.textContent = options.label;
    }

    if (options.supporting) {
        const supporting = document.createElement("span");
        supporting.slot = "supporting";
        supporting.textContent = options.supporting;
        element.append(supporting);
    }

    document.body.append(element);

    await customElements.whenDefined("violet-switch");
    await nextFrame();

    return element;
}

describe("violet-switch", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("toggles from its visual track and exposes switch semantics on the native control", async () => {
        const element = await renderSwitch({
            label: "Enable notifications",
            supporting: "Keeps morning alerts turned on.",
        });
        const input = element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const track = element.shadowRoot?.querySelector(".track") as HTMLLabelElement | null;

        expect(input?.getAttribute("role")).toBe("switch");
        expect(input?.checked).toBe(false);

        track?.click();
        await nextFrame();

        expect(element.checked).toBe(true);
        expect(input?.checked).toBe(true);
        expect(input?.getAttribute("aria-describedby")).toBe(element.supportingTextId);
    });

    it("participates in validation and form submission when required", async () => {
        const element = await renderSwitch({
            label: "Enable automation",
            required: true,
        });

        expect(element.checkValidity()).toBe(false);

        element.checked = true;
        await nextFrame();

        expect(element.checkValidity()).toBe(true);

        const form = document.createElement("form");
        form.append(element);
        const formData = new FormData(form);
        expect(formData.get("notifications")).toBe("enabled");
    });

    it("supports inline control-only rendering with an explicit accessible name", async () => {
        const element = await renderSwitch({
            checked: true,
            inline: true,
            ariaLabel: "Compact automation switch",
        });
        const input = element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

        expect(element.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
        expect(input?.getAttribute("aria-label")).toBe("Compact automation switch");
    });
});

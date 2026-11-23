import { afterEach, describe, expect, it } from "vitest";

import "./violet-radio";
import type { VioletRadio } from "./violet-radio";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderRadio(options: {
    inline?: boolean;
    label?: string;
    ariaLabel?: string;
} = {}): Promise<VioletRadio> {
    document.body.innerHTML = "";

    const radio = document.createElement("violet-radio") as VioletRadio;
    radio.value = "direct";
    radio.inline = options.inline ?? false;

    if (options.ariaLabel) {
        radio.setAttribute("aria-label", options.ariaLabel);
    }

    if (options.label) {
        radio.textContent = options.label;
    }

    document.body.append(radio);

    await customElements.whenDefined("violet-radio");
    await nextFrame();

    return radio;
}

describe("violet-radio", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("checks when clicked and emits a change-like state transition", async () => {
        const radio = await renderRadio({ label: "Direct seed" });
        const control = radio.shadowRoot?.querySelector(".root") as HTMLElement | null;

        expect(radio.checked).toBe(false);

        control?.click();
        await nextFrame();

        expect(radio.checked).toBe(true);
    });

    it.each([" ", "Enter"])("supports native focus and standalone keyboard activation with %s", async key => {
        const radio = await renderRadio({
            inline: true,
            ariaLabel: "Compact direct seed option",
        });
        const previousControl = document.createElement("button");
        document.body.prepend(previousControl);

        previousControl.focus();
        expect(document.activeElement).toBe(previousControl);

        radio.focus();
        expect(document.activeElement).toBe(radio);
        radio.dispatchEvent(
            new KeyboardEvent("keydown", {
                bubbles: true,
                key,
            })
        );
        await nextFrame();

        expect(radio.checked).toBe(true);
        expect(radio.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
        expect(radio.getAttribute("aria-label")).toBe("Compact direct seed option");
    });

    it("includes the label's longest word in its minimum width inside a table cell (#1579)", async () => {
        document.body.innerHTML = `
            <table style="width: 1px;">
                <tr>
                    <td><violet-radio id="rd" value="archived">Include archived items</violet-radio></td>
                </tr>
            </table>
        `;
        await customElements.whenDefined("violet-radio");
        await nextFrame();

        const radio = document.getElementById("rd") as VioletRadio;
        const hostRect = radio.getBoundingClientRect();
        const label = radio.shadowRoot?.querySelector(".label") as HTMLElement;
        const control = radio.shadowRoot?.querySelector(".control-shell") as HTMLElement;

        expect(hostRect.width).toBeGreaterThan(control.getBoundingClientRect().width + 30);
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    });
});

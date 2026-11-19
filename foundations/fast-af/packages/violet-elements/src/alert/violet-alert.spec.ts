import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";

import "./violet-alert";
import type { VioletAlert } from "./violet-alert";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderAlert(
    template = `
        <violet-alert tone="warning">
            <span slot="title">Check before planting</span>
            Soil temperature is below the preferred transplant range.
            <span slot="actions">Review changes</span>
        </violet-alert>
    `
): Promise<VioletAlert> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-alert");
    await nextFrame();
    return document.querySelector("violet-alert") as VioletAlert;
}

/** Emulates a dark forced-colours theme, as Windows' "Night sky" gives, or turns the emulation off. */
async function emulateForcedColors(active: boolean): Promise<void> {
    const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
    await session.send("Emulation.setEmulatedMedia", {
        features: active
            ? [
                  { name: "forced-colors", value: "active" },
                  { name: "prefers-color-scheme", value: "dark" },
              ]
            : [],
    });
}

/** What a system colour resolves to in the current colour scheme. */
function systemColor(name: string): string {
    const probe = document.createElement("span");
    probe.style.color = name;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
}

describe("violet-alert", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders title and actions from slots", async () => {
        const alert = await renderAlert();
        const titleSlot = alert.shadowRoot?.querySelector('slot[name="title"]') as HTMLSlotElement | null;
        const actionsSlot = alert.shadowRoot?.querySelector('slot[name="actions"]') as HTMLSlotElement | null;
        const titleText = titleSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();
        const actionsText = actionsSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();

        expect(titleText).toBe("Check before planting");
        expect(actionsText?.includes("Review changes")).toBe(true);
    });

    it("maps assertive announcement to alert semantics", async () => {
        const alert = await renderAlert(`<violet-alert announcement="assertive">Immediate attention needed.</violet-alert>`);
        const copy = alert.shadowRoot?.querySelector(".copy");

        expect(copy?.getAttribute("role")).toBe("alert");
        expect(copy?.getAttribute("aria-live")).toBe("assertive");
    });

    it("emits dismiss when the dismiss button is activated", async () => {
        const alert = await renderAlert(`<violet-alert dismissible>Saved successfully.</violet-alert>`);
        const handler = vi.fn();
        const dismissButton = alert.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        alert.addEventListener("dismiss", handler);
        dismissButton?.click();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    describe("under forced colours", () => {
        afterEach(async () => {
            await emulateForcedColors(false);
        });

        it("lets slotted content take the system colours while the frame keeps its own", async () => {
            await emulateForcedColors(true);
            const alert = await renderAlert(`
                <violet-alert tone="danger">
                    <span slot="title">Could not save</span>
                    <span class="body">The file is locked.</span>
                    <a slot="actions" href="#retry" style="color: rgb(24, 27, 26)">Retry</a>
                </violet-alert>
            `);

            const canvasText = systemColor("CanvasText");
            expect(matchMedia("(forced-colors: active)").matches).toBe(true);
            for (const selector of ['[slot="title"]', ".body"]) {
                const element = alert.querySelector(selector) as HTMLElement;
                expect(getComputedStyle(element).forcedColorAdjust).toBe("auto");
                expect(getComputedStyle(element).color).toBe(canvasText);
            }
            // A link keeps its own system colour, never the theme's.
            const action = alert.querySelector('[slot="actions"]') as HTMLElement;
            expect(getComputedStyle(action).forcedColorAdjust).toBe("auto");
            expect(getComputedStyle(action).color).toBe(systemColor("LinkText"));

            const card = alert.shadowRoot?.querySelector(".frame") as HTMLElement;
            const root = card.shadowRoot?.querySelector(".root") as HTMLElement;
            const leading = alert.shadowRoot?.querySelector(".leading") as HTMLElement;
            expect(getComputedStyle(root).forcedColorAdjust).toBe("none");
            expect(getComputedStyle(root).backgroundColor).toBe(systemColor("Canvas"));
            expect(getComputedStyle(leading).forcedColorAdjust).toBe("none");
            expect(getComputedStyle(leading).color).toBe(systemColor("ButtonText"));
        });
    });
});

import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

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

    it("dims a disabled switch's control and label but keeps its supporting text readable", async () => {
        const element = await renderSwitch({
            label: "Enable harvest sync",
            supporting: "Unavailable while the field audit is in progress.",
        });
        element.disabled = true;
        await nextFrame();

        const opacity = (selector: string) =>
            getComputedStyle(element.shadowRoot?.querySelector(selector) as Element).opacity;
        expect(opacity(".control-shell")).toBe("0.6");
        expect(opacity(".label")).toBe("0.6");
        expect(opacity(".supporting")).toBe("1");
        expect(opacity(".root")).toBe("1");
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

    describe("hit area", () => {
        function nativeInput(element: VioletSwitch): HTMLInputElement {
            return element.shadowRoot?.querySelector('input[type="checkbox"]') as HTMLInputElement;
        }

        function centerOf(target: Element): { x: number; y: number } {
            const rect = target.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }

        it("toggles from a role-based click without force", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            const changes: boolean[] = [];
            element.addEventListener("change", () => changes.push(element.checked));

            await page.getByRole("switch", { name: "Enable notifications" }).click();

            expect(element.checked).toBe(true);
            expect(nativeInput(element).checked).toBe(true);
            expect(changes).toEqual([true]);

            await page.getByRole("switch", { name: "Enable notifications" }).click();
            expect(element.checked).toBe(false);
            expect(changes).toEqual([true, false]);
        });

        it("toggles an inline switch from a role-based click", async () => {
            const element = await renderSwitch({ inline: true, ariaLabel: "Compact automation switch" });

            await page.getByRole("switch", { name: "Compact automation switch" }).click();

            expect(element.checked).toBe(true);
        });

        it("hit-tests the visible track to the native input and toggles exactly once", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
            const changes: boolean[] = [];
            element.addEventListener("change", () => changes.push(element.checked));

            const { x, y } = centerOf(track);
            expect(element.shadowRoot?.elementFromPoint(x, y)).toBe(nativeInput(element));

            // A real pointer at the track's centre: the control shell contains the input,
            // so Playwright's hit-test accepts it and the click lands where a person's would.
            await page.elementLocator(element.shadowRoot?.querySelector(".control-shell") as HTMLElement).click();

            expect(element.checked).toBe(true);
            expect(changes).toEqual([true]);
        });

        it("still toggles once when the track is clicked programmatically", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            const changes: boolean[] = [];
            element.addEventListener("change", () => changes.push(element.checked));

            (element.shadowRoot?.querySelector(".track") as HTMLElement).click();

            expect(element.checked).toBe(true);
            expect(changes).toEqual([true]);
        });

        it("toggles from a label click and from the keyboard", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });

            await page.elementLocator(element.shadowRoot?.querySelector(".label") as HTMLElement).click();
            expect(element.checked).toBe(true);

            nativeInput(element).focus();
            await userEvent.keyboard("{ }");
            expect(element.checked).toBe(false);
        });

        it("ignores clicks while disabled", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            element.disabled = true;
            await nextFrame();

            const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
            const { x, y } = centerOf(track);
            expect(element.shadowRoot?.elementFromPoint(x, y)).toBe(nativeInput(element));
            expect(nativeInput(element).disabled).toBe(true);

            track.click();
            nativeInput(element).click();

            expect(element.checked).toBe(false);
            expect(nativeInput(element).checked).toBe(false);
        });

        it("does not take clicks from a positioned overlay stacked above it", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            const overlay = document.createElement("div");
            const rect = element.shadowRoot?.querySelector(".track")?.getBoundingClientRect() as DOMRect;
            overlay.setAttribute(
                "style",
                `position:fixed;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`,
            );
            document.body.append(overlay);
            const { x, y } = centerOf(element.shadowRoot?.querySelector(".track") as HTMLElement);

            expect(document.elementFromPoint(x, y)).toBe(overlay);
            await page.elementLocator(overlay).click();
            expect(element.checked).toBe(false);
        });

        it("keeps the focus ring on the track when the input has keyboard focus", async () => {
            const element = await renderSwitch({ label: "Enable notifications" });
            const track = element.shadowRoot?.querySelector(".track") as HTMLElement;
            const before = getComputedStyle(track).boxShadow;

            await userEvent.tab();
            await nextFrame();

            expect(element.shadowRoot?.activeElement).toBe(nativeInput(element));
            expect(getComputedStyle(track).boxShadow).not.toBe(before);
        });
    });
});

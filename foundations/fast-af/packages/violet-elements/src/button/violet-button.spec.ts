import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-button";
import type { VioletButton } from "./violet-button";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderButton(
    configure?: (button: VioletButton) => void,
    label = "Save"
): Promise<VioletButton> {
    document.body.innerHTML = "";

    const button = document.createElement("violet-button") as VioletButton;
    button.textContent = label;
    configure?.(button);
    document.body.append(button);

    await customElements.whenDefined("violet-button");
    await nextFrame();

    return button;
}

function control(button: VioletButton): HTMLButtonElement {
    const native = button.shadowRoot?.querySelector("button");
    if (!native) {
        throw new Error("violet-button did not render its native control");
    }
    return native;
}

describe("violet-button", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a native button with defaults", async () => {
        const button = await renderButton();

        expect(button.appearance).toBe("primary");
        expect(button.type).toBe("button");
        expect(button.disabled).toBe(false);
        expect(control(button).getAttribute("type")).toBe("button");
        expect(control(button).getAttribute("data-appearance")).toBe("primary");
        expect(control(button).disabled).toBe(false);
    });

    it("forwards attributes to properties and the native control", async () => {
        const button = await renderButton(el => {
            el.setAttribute("appearance", "quiet");
            el.setAttribute("type", "submit");
            el.setAttribute("disabled", "");
        });

        expect(button.appearance).toBe("quiet");
        expect(button.type).toBe("submit");
        expect(button.disabled).toBe(true);
        expect(control(button).getAttribute("data-appearance")).toBe("quiet");
        expect(control(button).getAttribute("type")).toBe("submit");
        expect(control(button).disabled).toBe(true);
    });

    it("reflects property changes to host attributes and the control", async () => {
        const button = await renderButton();

        button.appearance = "transparent";
        button.disabled = true;
        await nextFrame();

        expect(button.getAttribute("appearance")).toBe("transparent");
        expect(button.hasAttribute("disabled")).toBe(true);
        expect(control(button).getAttribute("data-appearance")).toBe("transparent");
        expect(control(button).disabled).toBe(true);

        button.disabled = false;
        await nextFrame();

        expect(button.hasAttribute("disabled")).toBe(false);
        expect(control(button).disabled).toBe(false);
    });

    it.each([
        ["Enter", "{Enter}"],
        ["Space", "{ }"],
    ])("activates with the %s key and emits a click", async (_name, keys) => {
        const button = await renderButton();
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });

        button.focus();
        await userEvent.keyboard(keys);

        expect(clicks).toBe(1);
    });

    it("delegates focus to the inner control", async () => {
        const button = await renderButton();

        button.focus();

        expect(document.activeElement).toBe(button);
        expect(button.shadowRoot?.activeElement).toBe(control(button));
    });

    it("does not emit clicks or take focus when disabled", async () => {
        const button = await renderButton(el => {
            el.disabled = true;
        });
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });

        control(button).click();
        button.focus();
        await userEvent.keyboard("{Enter}");

        expect(clicks).toBe(0);
        expect(document.activeElement).not.toBe(button);
    });

    it("projects label, before and after slot content", async () => {
        const button = await renderButton(el => {
            const before = document.createElement("span");
            before.slot = "before";
            before.textContent = "<";
            const after = document.createElement("span");
            after.slot = "after";
            after.textContent = ">";
            el.append(before, after);
        });
        const root = button.shadowRoot as ShadowRoot;
        const defaultSlot = root.querySelector("slot:not([name])") as HTMLSlotElement;
        const beforeSlot = root.querySelector('slot[name="before"]') as HTMLSlotElement;
        const afterSlot = root.querySelector('slot[name="after"]') as HTMLSlotElement;

        expect(defaultSlot.assignedNodes().map(node => node.textContent)).toEqual(["Save"]);
        expect(beforeSlot.assignedElements()).toHaveLength(1);
        expect(afterSlot.assignedElements()).toHaveLength(1);
    });

    it("forwards aria properties to the native control", async () => {
        const button = await renderButton(el => {
            el.ariaLabel = "Save draft";
            el.ariaDescribedby = "hint";
            el.ariaControls = "panel";
            el.ariaExpanded = "false";
            el.ariaHasPopup = "menu";
        });
        const native = control(button);

        expect(native.getAttribute("aria-label")).toBe("Save draft");
        expect(native.getAttribute("aria-describedby")).toBe("hint");
        expect(native.getAttribute("aria-controls")).toBe("panel");
        expect(native.getAttribute("aria-expanded")).toBe("false");
        expect(native.getAttribute("aria-haspopup")).toBe("menu");

        button.ariaExpanded = "true";
        await nextFrame();
        expect(native.getAttribute("aria-expanded")).toBe("true");

        button.ariaExpanded = null;
        await nextFrame();
        expect(native.hasAttribute("aria-expanded")).toBe(false);
    });

    it("forwards aria attributes set on the host for controls, expanded and haspopup", async () => {
        const button = await renderButton(el => {
            el.setAttribute("aria-expanded", "true");
            el.setAttribute("aria-controls", "menu");
            el.setAttribute("aria-haspopup", "listbox");
        });
        const native = control(button);

        expect(native.getAttribute("aria-expanded")).toBe("true");
        expect(native.getAttribute("aria-controls")).toBe("menu");
        expect(native.getAttribute("aria-haspopup")).toBe("listbox");
    });

    describe("sizing", () => {
        const appearances = ["primary", "secondary", "quiet", "transparent"] as const;

        function targetSize(button: VioletButton): number {
            return Number.parseFloat(getComputedStyle(control(button)).getPropertyValue("--_target-size"));
        }

        function expectInside(inner: DOMRect, outer: DOMRect): void {
            expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
            expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
            expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
            expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
        }

        async function renderInto(markup: string, style = ""): Promise<VioletButton[]> {
            document.body.innerHTML = `<div id="host" style="${style}">${markup}</div>`;
            await customElements.whenDefined("violet-button");
            await nextFrame();
            return Array.from(document.querySelectorAll("violet-button")) as VioletButton[];
        }

        afterEach(() => {
            document.body.removeAttribute("style");
        });

        it("keeps a one-line label at exactly the target size", async () => {
            const buttons = await renderInto(
                appearances.map(appearance => `<violet-button appearance="${appearance}">Save</violet-button>`).join(""),
            );

            for (const button of buttons) {
                expect(control(button).getBoundingClientRect().height).toBeCloseTo(targetSize(button), 0);
            }
        });

        it("grows every button with its label when the body type tokens double", async () => {
            // Emulates 200% text-only zoom: the type tokens are px, so root font-size has no effect.
            document.body.style.setProperty("--type-body-md-size", "28px");
            document.body.style.setProperty("--type-body-md-line", "40px");
            const buttons = await renderInto(
                appearances
                    .map(appearance => `<violet-button appearance="${appearance}">Save changes</violet-button>`)
                    .join(""),
            );

            for (const button of buttons) {
                const controlRect = control(button).getBoundingClientRect();
                const labelRect = button.shadowRoot!.querySelector(".label")!.getBoundingClientRect();

                expect(labelRect.height).toBeGreaterThanOrEqual(40);
                expect(controlRect.height).toBeGreaterThan(targetSize(button));
                expectInside(labelRect, controlRect);
            }
        });

        it("wraps a long label inside the control instead of overflowing", async () => {
            const [button] = await renderInto(
                `<violet-button appearance="secondary">Save the planting schedule for every bed</violet-button>`,
                "inline-size: 140px",
            );
            const controlRect = control(button!).getBoundingClientRect();
            const labelRect = button!.shadowRoot!.querySelector(".label")!.getBoundingClientRect();
            const lineHeight = Number.parseFloat(getComputedStyle(control(button!)).lineHeight);

            expect(labelRect.height).toBeGreaterThanOrEqual(lineHeight * 2);
            expectInside(labelRect, controlRect);
            expect(controlRect.width).toBeLessThanOrEqual(140.5);
            expect(getComputedStyle(button!.shadowRoot!.querySelector(".label")!).textAlign).toBe("center");
        });

        it("keeps its own height beside a taller flex sibling", async () => {
            const [button] = await renderInto(
                `<violet-button>Save</violet-button><div style="block-size: 120px; inline-size: 40px"></div>`,
                "display: flex",
            );

            expect(control(button!).getBoundingClientRect().height).toBeCloseTo(targetSize(button!), 0);
        });
    });
});

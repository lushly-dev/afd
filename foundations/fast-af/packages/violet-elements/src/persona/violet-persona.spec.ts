import { afterEach, describe, expect, it } from "vitest";

import "./violet-persona";
import type { VioletPersona } from "./violet-persona";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderPersona(options: {
    label?: string;
    src?: string;
    initials?: string;
    decorative?: boolean;
    size?: "xs" | "sm" | "md" | "lg" | "xl";
} = {}): Promise<VioletPersona> {
    document.body.innerHTML = "";

    const element = document.createElement("violet-persona") as VioletPersona;
    element.label = options.label ?? "";
    element.src = options.src ?? "";
    element.initials = options.initials ?? "";
    element.decorative = options.decorative ?? false;
    element.size = options.size ?? "sm";
    document.body.append(element);

    await customElements.whenDefined("violet-persona");
    await nextFrame();

    return element;
}

describe("violet-persona", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("derives initials and accessible labeling from the persona label", async () => {
        const element = await renderPersona({ label: "Lydia Bauer" });
        const root = element.shadowRoot?.querySelector(".root") as HTMLElement | null;

        expect(root?.getAttribute("role")).toBe("img");
        expect(root?.getAttribute("aria-label")).toBe("Lydia Bauer");
        expect(element.shadowRoot?.querySelector(".fallback")?.textContent?.trim()).toBe("LB");
    });

    it("uses explicit initials and decorative mode when requested", async () => {
        const element = await renderPersona({
            initials: "AB",
            decorative: true,
        });
        const root = element.shadowRoot?.querySelector(".root") as HTMLElement | null;

        expect(root?.getAttribute("role")).toBe("presentation");
        expect(root?.getAttribute("aria-hidden")).toBe("true");
        expect(element.shadowRoot?.querySelector(".fallback")?.textContent?.trim()).toBe("AB");
    });

    it("falls back to initials when the image fails to load", async () => {
        const element = await renderPersona({
            label: "Katri Athokas",
            src: "https://example.invalid/avatar.png",
        });
        const image = element.shadowRoot?.querySelector(".image") as HTMLImageElement | null;

        image?.dispatchEvent(new Event("error"));
        await nextFrame();

        expect(element.imageFailed).toBe(true);
        expect(element.shadowRoot?.querySelector(".fallback")?.textContent?.trim()).toBe("KA");
    });
});

import { afterEach, describe, expect, it } from "vitest";

import "./violet-breadcrumb-item";
import type { VioletBreadcrumbItem } from "./violet-breadcrumb-item";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderItem(href: string): Promise<VioletBreadcrumbItem> {
    document.body.innerHTML = "";
    const item = document.createElement("violet-breadcrumb-item") as VioletBreadcrumbItem;
    item.href = href;
    item.textContent = "Library";
    document.body.append(item);
    await customElements.whenDefined("violet-breadcrumb-item");
    await nextFrame();
    return item;
}

describe("violet-breadcrumb-item", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it.each(["https://example.com/library", "mailto:team@example.com", "/library", "library"])(
        "renders %s as a link",
        async href => {
            const item = await renderItem(href);
            const link = item.shadowRoot?.querySelector<HTMLAnchorElement>("a.link");

            expect(link?.getAttribute("href")).toBe(href);
        }
    );

    it.each(["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,x"])(
        "renders %j as a plain label without a link",
        async href => {
            const item = await renderItem(href);
            const root = item.shadowRoot;

            expect(root?.querySelector("a")).toBeNull();
            expect(root?.querySelector("[href]")).toBeNull();
            expect(root?.querySelector(".label")).not.toBeNull();
        }
    );

    it("renders a label when there is no href", async () => {
        const item = await renderItem("");

        expect(item.shadowRoot?.querySelector("a")).toBeNull();
        expect(item.shadowRoot?.querySelector(".label")).not.toBeNull();
    });
});

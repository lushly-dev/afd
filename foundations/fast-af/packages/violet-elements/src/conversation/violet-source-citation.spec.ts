import { afterEach, describe, expect, it } from "vitest";

import "./violet-source-citation.define";
import type { VioletSourceCitation } from "./violet-source-citation";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderCitation(href: string, title = "Source title"): Promise<VioletSourceCitation> {
    document.body.innerHTML = "";
    const citation = document.createElement("violet-source-citation") as VioletSourceCitation;
    citation.type = "url";
    citation.href = href;
    citation.sourceTitle = title;
    document.body.append(citation);
    await customElements.whenDefined("violet-source-citation");
    await nextFrame();
    return citation;
}

describe("violet-source-citation", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it.each([
        "https://example.com/page",
        "http://example.com/page",
        "mailto:sources@example.com",
        "/docs/page",
        "page.html",
    ])("renders %s as a link", async href => {
        const citation = await renderCitation(href);
        const link = citation.shadowRoot?.querySelector<HTMLAnchorElement>("a.link");

        expect(link).not.toBeNull();
        expect(link?.getAttribute("href")).toBe(href);
        expect(link?.textContent?.trim()).toBe("Source title");
    });

    it.each([
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        " javascript:alert(1)",
        "java\tscript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
    ])("renders %j as plain text without a link", async href => {
        const citation = await renderCitation(href);
        const root = citation.shadowRoot;

        expect(root?.querySelector("a")).toBeNull();
        expect(root?.querySelector("[href]")).toBeNull();
        expect(root?.querySelector(".title")?.textContent?.trim()).toBe("Source title");
    });

    it("follows --violet-color-accent-text across themes and still honors --_text-link overrides", async () => {
        const citation = await renderCitation("https://example.com/page");
        const link = citation.shadowRoot?.querySelector<HTMLAnchorElement>("a.link");
        expect(link).not.toBeNull();
        expect(getComputedStyle(link as HTMLAnchorElement).color).toBe("rgb(27, 95, 128)");

        citation.style.setProperty("--violet-color-accent-text", "#a1d4f3");
        await nextFrame();
        expect(getComputedStyle(link as HTMLAnchorElement).color).toBe("rgb(161, 212, 243)");

        citation.style.setProperty("--_text-link", "#004a80");
        await nextFrame();
        expect(getComputedStyle(link as HTMLAnchorElement).color).toBe("rgb(0, 74, 128)");
    });
});

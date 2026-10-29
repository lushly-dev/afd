import { afterEach, describe, expect, it } from "vitest";

import "./violet-pagination";
import type { VioletPagination } from "./violet-pagination";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderPagination(markup: string): Promise<VioletPagination> {
    document.body.innerHTML = markup;
    await customElements.whenDefined("violet-pagination");
    await nextFrame();
    await nextFrame();
    return document.querySelector("violet-pagination") as VioletPagination;
}

describe("violet-pagination", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("marks the current page with aria-current", async () => {
        const pagination = await renderPagination(`
            <violet-pagination page="4" page-count="9"></violet-pagination>
        `);

        const currentButton = pagination.shadowRoot?.querySelector("[aria-current='page']");
        expect(currentButton?.textContent?.trim()).toBe("4");
    });

    it("emits page-change when navigating to another page", async () => {
        const pagination = await renderPagination(`
            <violet-pagination page="2" page-count="5"></violet-pagination>
        `);

        let emittedPage = 0;
        pagination.addEventListener("page-change", event => {
            emittedPage = (event as CustomEvent<{ page: number }>).detail.page;
        });

        const nextButton = pagination.shadowRoot?.querySelector("[aria-label='Next page']") as HTMLButtonElement | null;
        nextButton?.click();
        await nextFrame();

        expect(pagination.page).toBe(3);
        expect(emittedPage).toBe(3);
    });

    it("renders collapsed ranges for larger page counts", async () => {
        const pagination = await renderPagination(`
            <violet-pagination page="8" page-count="20" sibling-count="1" boundary-count="1"></violet-pagination>
        `);

        const ellipses = pagination.shadowRoot?.querySelectorAll(".ellipsis");
        expect(ellipses?.length).toBeGreaterThan(0);
    });
});

import { afterEach, describe, expect, it } from "vitest";

import "./violet-empty-state";
import type { VioletEmptyState } from "./violet-empty-state";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderEmptyState(): Promise<VioletEmptyState> {
    document.body.innerHTML = "";
    const state = document.createElement("violet-empty-state") as VioletEmptyState;
    state.heading = "No plans yet";
    state.message = "Create your first crop plan.";
    document.body.append(state);
    await customElements.whenDefined("violet-empty-state");
    await nextFrame();
    return state;
}

describe("violet-empty-state", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders heading and message copy from attributes", async () => {
        const state = await renderEmptyState();
        expect(state.shadowRoot?.textContent).toContain("No plans yet");
        expect(state.shadowRoot?.textContent).toContain("Create your first crop plan.");
    });

    it("detects slotted actions content", async () => {
        const state = await renderEmptyState();
        const action = document.createElement("button");
        action.slot = "actions";
        action.textContent = "Create";
        state.append(action);
        await nextFrame();

        expect(state.hasActions).toBe(true);
    });
});

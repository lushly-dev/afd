import { afterEach, describe, expect, it } from "vitest";

import {
  clearAnchorName,
  clearFallbackPosition,
  computeFallbackPosition,
  createAnchorName,
  FallbackPositionController,
  normalizePlacement,
  positionFloatingFallback,
  resolveCssLengthPx,
  syncAnchorNames,
} from "./overlay-positioning";

describe("overlay-positioning", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("generates distinct CSS dashed-ident anchor names per instance", () => {
    const a = createAnchorName("violet-popover", 0);
    const b = createAnchorName("violet-popover", 1);
    expect(a).toBe("--violet-popover-anchor-0");
    expect(b).toBe("--violet-popover-anchor-1");
    expect(a).not.toBe(b);
  });

  it("normalizes placement values with fallback", () => {
    expect(normalizePlacement("above")).toBe("above");
    expect(normalizePlacement("below")).toBe("below");
    expect(normalizePlacement("before")).toBe("before");
    expect(normalizePlacement("after")).toBe("after");
    expect(normalizePlacement("invalid", "above")).toBe("above");
    expect(normalizePlacement(undefined)).toBe("below");
  });

  it("computes positions for all four sides and flips on viewport overflow", () => {
    const viewport = { width: 800, height: 600 };
    const floating = { width: 160, height: 80 };

    // Centered below
    const below = computeFallbackPosition(
      { top: 100, bottom: 132, left: 200, right: 280, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "below", align: "center", gap: 8 },
    );
    expect(below).toEqual({ top: 140, left: 160, placement: "below" });

    // Flips below -> above near bottom edge
    const flippedAbove = computeFallbackPosition(
      { top: 540, bottom: 572, left: 200, right: 280, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "below", align: "center", gap: 8 },
    );
    expect(flippedAbove.placement).toBe("above");
    expect(flippedAbove.top).toBe(452);

    // Flips above -> below near top edge
    const flippedBelow = computeFallbackPosition(
      { top: 10, bottom: 42, left: 200, right: 280, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "above", align: "center", gap: 8 },
    );
    expect(flippedBelow.placement).toBe("below");
    expect(flippedBelow.top).toBe(50);

    // Flips after -> before near right edge
    const flippedBefore = computeFallbackPosition(
      { top: 200, bottom: 232, left: 700, right: 780, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "after", align: "center", gap: 8 },
    );
    expect(flippedBefore.placement).toBe("before");
    expect(flippedBefore.left).toBe(532);

    // Flips before -> after near left edge
    const flippedAfter = computeFallbackPosition(
      { top: 200, bottom: 232, left: 20, right: 100, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "before", align: "center", gap: 8 },
    );
    expect(flippedAfter.placement).toBe("after");
    expect(flippedAfter.left).toBe(108);

    // Start-aligned menu flips horizontally when overflowing right edge
    const startAligned = computeFallbackPosition(
      { top: 100, bottom: 132, left: 700, right: 780, width: 80, height: 32 },
      floating,
      viewport,
      { placement: "below", align: "start", gap: 4 },
    );
    expect(startAligned).toEqual({ top: 136, left: 620, placement: "below" });
  });

  it("syncs internal anchor names without mutating an external trigger's anchor-name", () => {
    const internal = document.createElement("span");
    const external = document.createElement("button");
    external.style.setProperty("anchor-name", "--author-owned");
    const floating = document.createElement("div");

    syncAnchorNames({
      internalAnchor: internal,
      externalAnchor: null,
      floating,
      anchorName: "--violet-popover-anchor-1",
    });
    expect(internal.style.getPropertyValue("anchor-name")).toBe("--violet-popover-anchor-1");
    expect(floating.style.getPropertyValue("position-anchor")).toBe("--violet-popover-anchor-1");

    // Switch to external anchor: clears internal anchor and position-anchor, preserves external author anchor-name.
    syncAnchorNames({
      internalAnchor: internal,
      externalAnchor: external,
      floating,
      anchorName: "--violet-popover-anchor-1",
    });
    expect(internal.style.getPropertyValue("anchor-name")).toBe("");
    expect(floating.style.getPropertyValue("position-anchor")).toBe("");
    expect(external.style.getPropertyValue("anchor-name")).toBe("--author-owned");

    // clearAnchorName removes only a matching name.
    clearAnchorName(external, "--violet-popover-anchor-99");
    expect(external.style.getPropertyValue("anchor-name")).toBe("--author-owned");
    clearAnchorName(external, "--author-owned");
    expect(external.style.getPropertyValue("anchor-name")).toBe("");
  });

  it("resolves CSS length values including leading-decimal rem, calc, absolute units, and 0px", () => {
    const host = document.createElement("div");
    host.style.fontSize = "20px";
    document.body.append(host);

    expect(resolveCssLengthPx("", host, 8)).toBe(8);
    expect(resolveCssLengthPx("not-a-length", host, 8)).toBe(8);
    expect(resolveCssLengthPx("0px", host, 8)).toBe(0);
    expect(resolveCssLengthPx("0", host, 8)).toBe(0);
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    expect(resolveCssLengthPx("0.5rem", host, 8)).toBeCloseTo(rootPx * 0.5, 1);
    expect(resolveCssLengthPx(".5rem", host, 8)).toBeCloseTo(rootPx * 0.5, 1);
    expect(resolveCssLengthPx("1rem", host, 8)).toBeCloseTo(rootPx, 1);
    expect(resolveCssLengthPx("calc(0.5rem + 2px)", host, 8)).toBeCloseTo(rootPx * 0.5 + 2, 1);
    expect(resolveCssLengthPx("1.5em", host, 8)).toBeCloseTo(30, 1);
    expect(resolveCssLengthPx("1in", host, 8)).toBeCloseTo(96, 1);
    expect(resolveCssLengthPx("12px", host, 8)).toBe(12);
  });

  it("positions floating elements via FallbackPositionController and clears on stop", () => {
    const anchor = document.createElement("button");
    anchor.style.position = "fixed";
    anchor.style.top = "120px";
    anchor.style.left = "140px";
    anchor.style.width = "80px";
    anchor.style.height = "30px";

    const floating = document.createElement("div");
    floating.style.width = "120px";
    floating.style.height = "40px";

    document.body.append(anchor, floating);

    const controller = new FallbackPositionController();
    controller.start(
      () => anchor,
      () => floating,
      () => ({ placement: "below", align: "center", gap: 8 }),
      true,
    );

    expect(floating.style.position).toBe("fixed");
    expect(floating.style.top).toBe("158px");
    expect(floating.style.left).toBe("120px");

    const result = positionFloatingFallback(anchor, floating, { placement: "above", gap: 8 });
    expect(result.placement).toBe("above");
    expect(floating.style.top).toBe("72px");

    controller.stop(floating);
    expect(floating.style.top).toBe("");
    expect(floating.style.left).toBe("");
    clearFallbackPosition(null);
  });
});

import { describe, expect, it } from "vitest";

import {
    cellElementFromEvent,
    cellElementFromTarget,
    closestFromEventPath,
    eventPathElements,
} from "./violet-data-grid-events";

function makeEventWithPath(path: EventTarget[]): Event {
    return {
        composedPath: () => path,
    } as Event;
}

describe("violet-data-grid-events helpers", () => {
    it("collects HTMLElement entries from a composed path", () => {
        const cell = document.createElement("td");
        const text = document.createTextNode("hello");
        cell.append(text);

        expect(eventPathElements(makeEventWithPath([text, cell]))).toEqual([cell]);
    });

    it("finds the closest matching element in the event path", () => {
        const cell = document.createElement("td");
        cell.dataset.rowId = "row-1";
        cell.dataset.columnId = "status";
        const span = document.createElement("span");
        cell.append(span);

        const match = closestFromEventPath<HTMLTableCellElement>(makeEventWithPath([span, cell]), "td[data-row-id][data-column-id]");
        expect(match).toBe(cell);
    });

    it("resolves a cell element from a target or event path", () => {
        const cell = document.createElement("td");
        cell.dataset.rowId = "row-1";
        cell.dataset.columnId = "status";
        const span = document.createElement("span");
        cell.append(span);

        expect(cellElementFromTarget(span)).toBe(cell);
        expect(cellElementFromEvent(makeEventWithPath([span, cell]))).toBe(cell);
    });
});

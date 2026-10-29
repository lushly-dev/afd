export function eventPathElements(event: Event): HTMLElement[] {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const elements: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    const pushUnique = (element: HTMLElement): void => {
        if (seen.has(element)) {
            return;
        }

        seen.add(element);
        elements.push(element);
    };

    for (const entry of path) {
        if (entry instanceof HTMLElement) {
            pushUnique(entry);
            continue;
        }

        if (entry instanceof Node && entry.parentElement instanceof HTMLElement) {
            pushUnique(entry.parentElement);
        }
    }

    return elements;
}

export function closestFromEventPath<T extends HTMLElement>(event: Event, selector: string): T | null {
    for (const element of eventPathElements(event)) {
        const match = element.closest(selector);
        if (match instanceof HTMLElement) {
            return match as T;
        }
    }

    return null;
}

export function cellElementFromTarget(target: EventTarget | null): HTMLTableCellElement | null {
    const element =
        target instanceof HTMLElement
            ? target
            : target instanceof Node
              ? target.parentElement
              : null;

    if (!element) {
        return null;
    }

    return element.closest("td[data-row-id][data-column-id]") as HTMLTableCellElement | null;
}

export function cellElementFromEvent(event: Event): HTMLTableCellElement | null {
    return closestFromEventPath<HTMLTableCellElement>(event, "td[data-row-id][data-column-id]");
}

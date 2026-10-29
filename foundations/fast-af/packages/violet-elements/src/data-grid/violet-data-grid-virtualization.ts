import type { VirtualItem } from "@tanstack/virtual-core";

export interface VioletVirtualizedRowLike {
    id: string;
}

export interface VioletRenderedVirtualRow<RowLike, ItemLike extends Pick<VirtualItem, "index">> {
    item: ItemLike;
    row: RowLike;
}

export function buildRenderedRows<RowLike extends VioletVirtualizedRowLike, ItemLike extends VirtualItem>(options: {
    virtualize: boolean;
    rows: RowLike[];
    estimatedRowHeight: number;
    virtualItems: ItemLike[];
    totalSize: number;
}): {
    renderedRows: VioletRenderedVirtualRow<RowLike, ItemLike | VirtualItem>[];
    virtualPaddingStart: number;
    virtualPaddingEnd: number;
} {
    if (!options.virtualize) {
        return {
            renderedRows: options.rows.map((row, index) => ({
                item: {
                    key: row.id,
                    index,
                    start: index * options.estimatedRowHeight,
                    end: (index + 1) * options.estimatedRowHeight,
                    size: options.estimatedRowHeight,
                    lane: 0,
                },
                row,
            })),
            virtualPaddingStart: 0,
            virtualPaddingEnd: 0,
        };
    }

    const firstItem = options.virtualItems[0];
    const lastItem = options.virtualItems[options.virtualItems.length - 1];

    return {
        renderedRows: options.virtualItems
            .map(item => {
                const row = options.rows[item.index];
                return row ? { item, row } : null;
            })
            .filter((value): value is VioletRenderedVirtualRow<RowLike, ItemLike> => value !== null),
        virtualPaddingStart: firstItem?.start ?? 0,
        virtualPaddingEnd: Math.max(0, options.totalSize - (lastItem?.end ?? 0)),
    };
}

export function buildVirtualizerUpdateOptions<RowLike extends VioletVirtualizedRowLike>(options: {
    rows: RowLike[];
    estimatedRowHeight: number;
    overscanCount: number;
    virtualize: boolean;
}): {
    count: number;
    estimateSize: () => number;
    overscan: number;
    enabled: boolean;
    getItemKey: (index: number) => string | number;
} {
    return {
        count: options.rows.length,
        estimateSize: () => options.estimatedRowHeight,
        overscan: options.overscanCount,
        enabled: options.virtualize && options.rows.length > 0,
        getItemKey: (index: number) => options.rows[index]?.id ?? index,
    };
}

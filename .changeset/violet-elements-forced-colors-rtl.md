---
"@lushly-dev/violet-elements": patch
---

Finish forced-colors and right-to-left coverage (#509):
- `violet-data-grid`: in forced-colors mode, selected cells and rows take `Highlight` with `HighlightText`, the active cell keeps `Canvas` inside a `Highlight` ring, the focused cell adds an inner `Highlight` outline, the row checkbox column stays `Canvas`, and column resizers draw in `CanvasText`, so selection no longer depends on a background tint that forced colours remove.
- `violet-data-grid`: dragging a column resizer in right-to-left grows the column toward its trailing edge (leftward) instead of shrinking it.
- `violet-slider` and `violet-range-slider`: in right-to-left the thumbs stay centred on their mirrored positions, a pointer reads its value from the right edge, and each range-slider input takes the half of the track its own thumb is on. ArrowLeft and ArrowRight now move the thumb in their visual direction in every engine; WebKit's native range input did not flip them.
- `violet-select`: the trigger's caret keeps pointing down in right-to-left; it was drawn from logical edges and pointed sideways.

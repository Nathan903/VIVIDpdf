import json
from pathlib import Path
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Patch
from itertools import cycle

# --- config ---
INPUT_JSON = Path("attention.json")
SHOW_TEXT = True           # toggle to hide/show the overlaid text
FONT_SIZE_FALLBACK = 8     # used when we can't infer size cleanly
EDGE_WIDTH = 1.0           # box edge width
FACE_ALPHA = 0.0           # keep boxes transparent; change to e.g. 0.1 to tint

def load_pdfjs_items(path: Path):
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("items", [])

def compute_canvas_extent(items):
    if not items:
        return (0, 100, 0, 100)

    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = float("-inf"), float("-inf")

    for it in items:
        tr = it.get("transform", [0,0,0,0,0,0])
        if len(tr) != 6:
            continue
        a,b,c,d,e,f = tr
        w = float(it.get("width", 0) or 0)
        h = float(it.get("height", 0) or 0)

        x0 = float(e)
        y0 = float(f) - h  # pdf.js baseline is (e,f); box lower-left is (e, f - h)

        min_x = min(min_x, x0)
        min_y = min(min_y, y0)
        max_x = max(max_x, x0 + w)
        max_y = max(max_y, y0 + h)

    pad_x = 0.02 * max(1.0, max_x - min_x)
    pad_y = 0.02 * max(1.0, max_y - min_y)
    return (min_x - pad_x, max_x + pad_x, min_y - pad_y, max_y + pad_y)

def build_font_color_map(items):
    """Assign a distinct color to each fontName using matplotlib's default cycle."""
    # Default color cycle
    color_cycle = cycle(plt.rcParams['axes.prop_cycle'].by_key().get('color', ['C0']))
    font_names = []
    for it in items:
        fn = it.get("fontName", "unknown")
        if fn not in font_names:
            font_names.append(fn)
    return {fn: next(color_cycle) for fn in font_names}

def draw_boxes(ax, items, color_map):
    legend_fonts = set()
    i=0
    for it in items:
        text = it.get("str", "") 
        if i==43:
            print("[text]",i,f"[{text}]")
        if not text or not text.strip(): continue
        text = f"[{i}]" + text
        i+=1
        tr = it.get("transform", [0,0,0,0,0,0])
        if len(tr) != 6:
            continue
        a,b,c,d,e,f = tr
        w = float(it.get("width", 0) or 0)
        h = float(it.get("height", 0) or 0)

        x = float(e)
        y = float(f) - h

        font_name = it.get("fontName", "unknown")
        edge_color = color_map.get(font_name, 'black')
        # dashed line if hasEOL True
        linestyle = '--' if it.get("hasEOL", False) else '-'

        rect = Rectangle(
            (x, y),
            w, h,
            facecolor=(edge_color if FACE_ALPHA > 0 else "none"),
            edgecolor=edge_color,
            linewidth=EDGE_WIDTH,
            linestyle=linestyle,
            alpha=FACE_ALPHA if FACE_ALPHA > 0 else 1.0
        )
        ax.add_patch(rect)

        if SHOW_TEXT and text:
            fs = max(FONT_SIZE_FALLBACK, abs(float(d)) if d else FONT_SIZE_FALLBACK)
            ax.text(
                x + 1, y + h * 0.75,
                text,
                fontsize=fs * 0.8,
                va="center",
                ha="left"
            )

        legend_fonts.add(font_name)

    # Build legend (one entry per fontName)
    handles = [Patch(facecolor="none", edgecolor=color_map[fn], label=fn, linewidth=EDGE_WIDTH) for fn in legend_fonts]
    if handles:
        ax.legend(handles=handles, title="fontName", loc="upper right", frameon=True)

from math import hypot

def find_islands(items, margin):
    """
    Return all items that have no neighbors within `margin` distance.
    Position is taken from item['transform'][4:6].
    """
    # Precompute positions
    positions = [
        (item['transform'][4], item['transform'][5])
        for item in items
    ]

    islands = []
    n = len(items)

    for i in range(n):
        x_i, y_i = positions[i]
        has_neighbor = False

        for j in range(n):
            if i == j:
                continue
            x_j, y_j = positions[j]

            # Euclidean distance
            if hypot(x_i - x_j, y_i - y_j) <= margin:
                has_neighbor = True
                break

        if not has_neighbor:
            islands.append(items[i])

    return islands


def main():
    items = load_pdfjs_items(INPUT_JSON)
    items = find_islands(items,30)
    text = ""
    for it in items:
        text += it.get("str", "")

    # exit()
    color_map = build_font_color_map(items)

    fig, ax = plt.subplots(figsize=(10, 12))

    xmin, xmax, ymin, ymax = compute_canvas_extent(items)
    draw_boxes(ax, items, color_map)

    ax.set_aspect("equal")
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)

    # If the page appears upside down for your data, uncomment the next line:
    # ax.invert_yaxis()

    ax.set_xlabel("X (PDF units)")
    ax.set_ylabel("Y (PDF units)")
    ax.set_title("pdf.js Text Bounding Boxes by fontName (dashed = hasEOL)")
    ax.grid(True, linestyle="--", linewidth=0.3, alpha=0.5)

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    main()

import json
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

def load_mineru(filepath):
    """Load MinerU-style JSON file."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

def get_page_bounds(items, page_idx):
    """Compute overall width/height bounds for a given page."""
    xs, ys = [], []
    for item in items:
        if item.get("page_idx", 0) != page_idx:
            continue
        x0, y0, x1, y1 = item["bbox"]
        xs += [x0, x1]
        ys += [y0, y1]
    if not xs or not ys:
        return 0, 0
    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    return width, height

def plot_page_boxes(items, page_idx=0, show_text_labels=False):
    """Plot bounding boxes for a given page_idx."""
    # Filter items for the page
    page_items = [it for it in items if it.get("page_idx", 0) == page_idx]
    if not page_items:
        print(f"No items found for page_idx={page_idx}")
        return

    # Get page size from bounding boxes
    width, height = get_page_bounds(items, page_idx)
    if width == 0 or height == 0:
        width, height = 1000, 1000  # fallback

    fig, ax = plt.subplots(figsize=(8, 10))
    i=0
    # Draw each bounding box
    for item in page_items:
        bbox = item["bbox"]  # [x0, y0, x1, y1]
        x0, y0, x1, y1 = bbox
        w = x1 - x0
        h = y1 - y0

        # Choose color by type (optional)
        itype = item.get("type", "other")
        if itype == "text":
            edge_color = "blue"
        elif itype == "equation":
            edge_color = "green"
        elif itype == "image":
            edge_color = "red"
        elif itype == "table":
            edge_color = "purple"
        else:
            edge_color = "black"

        rect = Rectangle(
            (x0, y0),
            w,
            h,
            fill=False,
            edgecolor=edge_color,
            linewidth=1.0
        )
        ax.add_patch(rect)

        if show_text_labels:
            # small label with type or truncated text
            label = str(i)+str(item.get("text", "")).replace("$","")
            i+=1
            ax.text(
                x0 + 2,
                y0 + 10,
                label,
                fontsize=6,
                va="top",
                ha="left"
            )

    ax.set_xlim(0, width)
    ax.set_ylim(0, height)
    ax.set_aspect("equal", adjustable="box")

    # Invert y-axis because PDF coordinates usually have origin at top-left
    ax.invert_yaxis()

    ax.set_title(f"Bounding boxes for page_idx={page_idx}")
    ax.set_xlabel("x")
    ax.set_ylabel("y")

    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    # Path to your MinerU JSON file
    json_path = "2511.07197v1_content_list.json"  # change to your filename
    data = load_mineru(json_path)

    # data is expected to be a list of items (like in your example)
    plot_page_boxes(data, page_idx=0, show_text_labels=True)

import io, json, base64, argparse
from pathlib import Path
import pdfplumber
from pypdf import PdfReader

def pdf_get_text_content(path: str, image_previews=False, image_max_bytes=200_000):
    p = Path(path)
    out = {"meta": {}, "pages": []}

    # Light metadata via pypdf (tolerant & fast)
    try:
        r = PdfReader(str(p))
        info = r.metadata or {}
        out["meta"] = {
            "file_name": p.name,
            "title": getattr(info, "title", None),
            "author": getattr(info, "author", None),
            "producer": getattr(info, "producer", None),
            "pages": len(r.pages),
        }
    except Exception as e:
        out["meta"] = {"file_name": p.name, "warning": f"metadata_error: {e}"}

    # Page-by-page extraction (streams; good for large PDFs)
    with pdfplumber.open(str(p)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_obj = {"page_num": i}

            # 1) Plain text (fast)
            try:
                page_obj["text"] = page.extract_text() or ""
            except Exception as e:
                page_obj["text"] = ""
                page_obj["text_warning"] = f"text_error: {e}"

            # 2) Words with bounding boxes (useful for later UI/highlighting)
            try:
                words = page.extract_words(use_text_flow=True) or []
                page_obj["words"] = [
                    {
                        "text": w["text"],
                        "x0": float(w["x0"]),
                        "y0": float(w["top"]),
                        "x1": float(w["x1"]),
                        "y1": float(w["bottom"]),
                    }
                    for w in words
                ]
            except Exception as e:
                page_obj["words"] = []
                page_obj["words_warning"] = f"words_error: {e}"

            # 3) Images (bounding boxes + tiny optional preview)
            try:
                images = []
                for im in page.images:
                    rec = {
                        "x0": float(im["x0"]),
                        "y0": float(im["top"]),
                        "x1": float(im["x1"]),
                        "y1": float(im["bottom"]),
                        "width": int(im.get("width", 0)),
                        "height": int(im.get("height", 0)),
                        "name": im.get("name"),
                    }
                    if image_previews:
                        try:
                            cropped = page.crop((rec["x0"], rec["y0"], rec["x1"], rec["y1"]))
                            pil_img = cropped.to_image(resolution=150).original
                            buf = io.BytesIO()
                            pil_img.save(buf, format="PNG", optimize=True)
                            data = buf.getvalue()
                            rec["b64_preview_png"] = (
                                "data:image/png;base64," + base64.b64encode(data).decode("ascii")
                                if len(data) <= image_max_bytes else None
                            )
                        except Exception:
                            rec["b64_preview_png"] = None
                    images.append(rec)
                page_obj["images"] = images
            except Exception as e:
                page_obj["images"] = []
                page_obj["images_warning"] = f"images_error: {e}"

            # 4) Tables (try two strategies; keep whatever is found)
            try:
                tables = []
                for strategy in ("lines", "text"):
                    ts = page.extract_tables(
                        table_settings={"vertical_strategy": strategy, "horizontal_strategy": strategy}
                    )
                    for t in ts or []:
                        tables.append(t)
                page_obj["tables"] = tables
            except Exception as e:
                page_obj["tables"] = []
                page_obj["tables_warning"] = f"tables_error: {e}"

            out["pages"].append(page_obj)

    return out

def main():
    ap = argparse.ArgumentParser(description="Extract text + words + images + tables from a PDF.")
    ap.add_argument("--in", dest="inp", required=True, help="Input PDF path")
    ap.add_argument("--out", dest="outp", required=True, help="Output JSON path")
    ap.add_argument("--image-previews", action="store_true", help="Embed tiny PNG previews (slower & bigger JSON)")
    ap.add_argument("--image-max-bytes", type=int, default=200_000, help="Cap for embedded preview size")
    args = ap.parse_args()

    result = pdf_get_text_content(args.inp, image_previews=args.image_previews, image_max_bytes=args.image_max_bytes)
    Path(args.outp).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✔ Wrote {args.outp}")

if __name__ == "__main__":
    main()

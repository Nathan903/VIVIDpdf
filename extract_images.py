import io, json, base64, argparse, os
from pathlib import Path
from typing import Dict, Any, List, Optional
import pdfplumber
from pypdf import PdfReader
from PIL import Image

def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def guess_ext_from_filter(flt: Optional[Any]) -> str:
    if flt is None:
        return ".bin"
    # Filter may be a NameObject or ArrayObject
    names = []
    if isinstance(flt, list):
        names = [str(x) for x in flt]
    else:
        names = [str(flt)]
    if any("DCTDecode" in n for n in names):
        return ".jpg"
    if any("JPXDecode" in n for n in names):
        return ".jp2"
    if any("FlateDecode" in n for n in names):
        # could be PNG-encodable data after inflate; we'll write PNG
        return ".png"
    if any("CCITTFaxDecode" in n for n in names):
        return ".tiff"
    return ".bin"

def save_raw_image_from_xobject(obj, out_dir: Path, base_name: str) -> Optional[str]:
    """
    Best-effort: extract embedded image stream via pypdf.
    Returns path to saved file or None if not extractable.
    """
    try:
        data = obj.get_data()  # pypdf decodes streams per filters when possible
        cs = obj.get("/ColorSpace", None)
        bpc = obj.get("/BitsPerComponent", None)
        flt = obj.get("/Filter", None)

        ext = guess_ext_from_filter(flt)
        out_path = out_dir / f"{base_name}{ext}"

        # If pypdf already decoded to raw bytes, we may need to wrap into an image.
        # Heuristic handling:
        if ext in (".jpg", ".jp2"):
            out_path.write_bytes(data)
            return str(out_path)

        if ext == ".png":
            # Try to wrap raw bytes as a PNG via PIL if possible; otherwise just write.
            try:
                # Sometimes pypdf returns already-deflated bytes that PIL can read
                img = Image.open(io.BytesIO(data))
                img.save(out_path)
                return str(out_path)
            except Exception:
                # fallback: write raw bytes
                out_path.write_bytes(data)
                return str(out_path)

        if ext == ".tiff":
            # Some CCITT streams need wrapping into a TIFF container; this is nontrivial.
            # For demo simplicity, we just dump the bytes.
            out_path.write_bytes(data)
            return str(out_path)

        # Unknown: just dump bytes
        out_path.write_bytes(data)
        return str(out_path)
    except Exception:
        return None

def extract_images(pdf_path: str, out_dir: str, previews=True, raw=True, dpi=150, max_preview_bytes=400_000):
    pdf_p = Path(pdf_path)
    out_root = Path(out_dir)
    ensure_dir(out_root)
    img_dir = out_root / "images"
    ensure_dir(img_dir)

    manifest: Dict[str, Any] = {
        "file": pdf_p.name,
        "pages": [],
    }

    # Open pypdf for XObject traversal (raw streams + metadata)
    reader = PdfReader(str(pdf_p))

    # Open pdfplumber for layout & bbox detection (reliable placement)
    with pdfplumber.open(str(pdf_p)) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_entry = {"page_num": page_idx + 1, "images": []}

            # Build a quick map of XObject images on this page (by name) using pypdf
            xobj_images = {}
            try:
                pg = reader.pages[page_idx]
                resources = pg.get("/Resources", {})
                xobj = resources.get("/XObject", {})
                # xobj is a dictionary of Name → XObject
                for name, obj in xobj.items():
                    try:
                        subtype = obj.get("/Subtype", "")
                        if str(subtype) == "/Image":
                            xobj_images[str(name)] = obj
                    except Exception:
                        pass
            except Exception:
                pass

            # pdfplumber: iterate detected images w/ bbox + width/height
            for i, im in enumerate(page.images):
                rec: Dict[str, Any] = {
                    "index": i,
                    "name": im.get("name"),
                    "bbox": {
                        "x0": float(im["x0"]),
                        "y0": float(im["top"]),
                        "x1": float(im["x1"]),
                        "y1": float(im["bottom"]),
                    },
                    "reported_width": int(im.get("width", 0)),
                    "reported_height": int(im.get("height", 0)),
                    "preview_path": None,
                    "raw_path": None,
                    "filters": None,
                    "colorspace": None,
                    "bits_per_component": None,
                }

                # A) Preview: rasterize the bbox region (fast & always works)
                if previews:
                    try:
                        crop = page.crop((rec["bbox"]["x0"], rec["bbox"]["y0"], rec["bbox"]["x1"], rec["bbox"]["y1"]))
                        pil = crop.to_image(resolution=dpi).original
                        out_path = img_dir / f"p{page_idx+1}_img{i}_preview.png"
                        buf = io.BytesIO()
                        pil.save(buf, format="PNG", optimize=True)
                        data = buf.getvalue()
                        if len(data) > max_preview_bytes:
                            # downscale if huge
                            pil.thumbnail((pil.width // 2, pil.height // 2))
                            pil.save(out_path)
                        else:
                            out_path.write_bytes(data)
                        rec["preview_path"] = str(out_path)
                    except Exception:
                        pass

                # B) Raw stream: try to pull embedded image object via pypdf
                xname = rec["name"]
                if raw and xname and xname in xobj_images:
                    obj = xobj_images[xname]
                    try:
                        rec["filters"] = str(obj.get("/Filter", None))
                        rec["colorspace"] = str(obj.get("/ColorSpace", None))
                        rec["bits_per_component"] = int(obj.get("/BitsPerComponent", 0)) if obj.get("/BitsPerComponent") else None
                        raw_path = save_raw_image_from_xobject(obj, img_dir, f"p{page_idx+1}_img{i}_raw")
                        rec["raw_path"] = raw_path
                    except Exception:
                        pass

                page_entry["images"].append(rec)

            manifest["pages"].append(page_entry)

    (out_root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest

def main():
    ap = argparse.ArgumentParser(description="Extract images + metadata from a PDF.")
    ap.add_argument("--in", dest="inp", required=True, help="Input PDF")
    ap.add_argument("--out", dest="out_dir", required=True, help="Output folder")
    ap.add_argument("--no-previews", action="store_true", help="Disable rasterized previews")
    ap.add_argument("--no-raw", action="store_true", help="Disable raw image stream extraction")
    ap.add_argument("--dpi", type=int, default=150, help="Preview DPI")
    args = ap.parse_args()

    ensure_dir(Path(args.out_dir))
    manifest = extract_images(
        args.inp,
        args.out_dir,
        previews=not args.no_previews,
        raw=not args.no_raw,
        dpi=args.dpi,
    )
    print(f"✔ Done. See: {args.out_dir}/manifest.json")

if __name__ == "__main__":
    main()

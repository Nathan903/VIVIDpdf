import os
import sys
import time
from pathlib import Path
from google import genai

MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

def build_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("Missing GEMINI_API_KEY env var. Set it first.")
    return genai.Client(api_key=api_key)


def upload_pdf_once(client: genai.Client, pdf_path: str):
    p = Path(pdf_path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"PDF not found: {p}")
    if p.suffix.lower() != ".pdf":
        raise ValueError(f"Not a PDF file: {p}")

    try:
        uploaded = client.files.upload(file=str(p))
    except TypeError:
        uploaded = client.files.upload(path=str(p))

    return uploaded.uri, p.name


def main() -> None:
    client = build_client()

    print(f"Gemini PDF CLI (upload once) | model: {MODEL}")
    print("Commands:")
    print("  /pdf <path>   Upload PDF once (replaces current PDF)")
    print("  /reset        Clear chat history")
    print("  /exit         Quit\n")

    pdf_uri = None
    pdf_name = None

    history = []  # list[{"role": "...", "parts": [{"text": "..."}]}]

    while True:
        try:
            user_input = input("You> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            return

        if not user_input:
            continue

        cmd = user_input.lower()

        if cmd in {"/exit", "/quit", "exit", "quit"}:
            print("Bye.")
            return

        if cmd in {"/reset", "reset"}:
            history.clear()
            print("(context cleared)\n")
            continue

        if cmd.startswith("/pdf"):
            parts = user_input.split(maxsplit=1)
            if len(parts) == 1:
                print("Usage: /pdf <path-to-pdf>\n")
                continue
            path = parts[1].strip().strip('"')
            try:
                pdf_uri, pdf_name = upload_pdf_once(client, path)
                history.clear() 
                print(f"(PDF uploaded once: {pdf_name})\n")
            except Exception as e:
                print(f"\n[Error uploading PDF] {type(e).__name__}: {e}\n")
            continue

        if not pdf_uri or not pdf_name:
            print("No PDF uploaded yet. Use: /pdf <path-to-pdf>\n")
            continue

        prompt = user_input
        if "第一页" in user_input or "第1页" in user_input or "page 1" in user_input.lower():
            prompt = (
                "Please answer based ONLY on page 1 of the provided PDF. "
                "Do NOT use or reference content after page 1. "
                "If page 1 does not contain enough information, say so.\n\n"
                f"User request: {user_input}"
            )

        contents = history + [
            {
                "role": "user",
                "parts": [
                    {
                        "file_data": {
                            "mime_type": "application/pdf",
                            "file_uri": pdf_uri,
                        }
                    },
                    {"text": f"Document name: {pdf_name}"},
                    {"text": prompt},
                ],
            }
        ]

        try:
            resp = client.models.generate_content(
                model=MODEL,
                contents=contents,
            )
            answer = (getattr(resp, "text", None) or "").strip()
        except Exception as e:
            print(f"\n[Error] {type(e).__name__}: {e}\n")
            msg = str(e).lower()
            if "429" in msg or "quota" in msg or "rate" in msg:
                print("Tip: You may be hitting Free Tier rate limits. Try slowing down.\n")
            continue

        print("\nGemini>")
        print(answer + "\n")

        history.append({"role": "user", "parts": [{"text": f"[{pdf_name}] {user_input}"}]})
        history.append({"role": "model", "parts": [{"text": answer}]})

        time.sleep(0.15)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

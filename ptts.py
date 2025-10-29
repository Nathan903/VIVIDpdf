# ptts.py — VIVID PDF: multilingual TTS with EN/ZH segmentation
# Usage examples:
#   python ptts.py --text "Hello, 你好, welcome to VIVID!" --out vivid_mix.wav
#   python ptts.py --text "Hello, 你好" --zh_model tts_models/zh-CN/baker/vits --zh_speed 1.5 --out demo.wav
#   python ptts.py --text "Hello, 你好" --speaker_wav samples/myvoice.wav --out cloned.wav
#   python ptts.py --textfile sample.txt --out final.wav

import argparse
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from pydub import AudioSegment
from TTS.api import TTS


# ---------------------- Segmentation ----------------------

def segment_runs(text: str):
    """
    Deterministic EN/ZH segmentation:
    - Walks characters; switches run on script change (CJK vs non-CJK).
    - Keeps punctuation with the preceding run.
    - Then lightly splits EN runs on , . ! ? ; to keep chunks short.
    Returns a list of chunk strings in original order.
    """
    def is_cjk(ch):
        return '\u4e00' <= ch <= '\u9fff'

    runs = []
    buf = []
    cur_lang = None  # 'en' or 'zh'

    for ch in text:
        ch_lang = 'zh' if is_cjk(ch) else 'en'
        if cur_lang is None:
            cur_lang = ch_lang
        if ch_lang != cur_lang:
            s = ''.join(buf).strip()
            if s:
                runs.append((cur_lang, s))
            buf = [ch]
            cur_lang = ch_lang
        else:
            buf.append(ch)

    s = ''.join(buf).strip()
    if s:
        runs.append((cur_lang, s))

    # Post-split EN runs by punctuation
    final = []
    for lang, chunk in runs:
        if lang == 'en':
            parts = re.split(r'([.!?;,]+[\s]*)', chunk)
            acc = ""
            for p in parts:
                if not p: continue
                if re.fullmatch(r'[.!?;,]+[\s]*', p):
                    acc += p
                    if acc.strip():
                        final.append(acc.strip())
                    acc = ""
                else:
                    acc += p
            if acc.strip():
                final.append(acc.strip())
        else:
            c = chunk.strip()
            if c:
                final.append(c)
    return final


def lang_of(segment: str) -> str:
    return "zh" if any('\u4e00' <= ch <= '\u9fff' for ch in segment) else "en"


# ---------------------- Backends ----------------------

def get_tts_backend(
    speaker_wav: str | None,
    zh_model: str | None,
    en_model: str | None,
    zh_speed: float,
    en_speed: float,
):
    """
    Returns synth(seg_text, lang, out_file) using:
      - XTTS v2 (one model, same voice across languages) if speaker_wav provided
      - OR per-language single-speaker models (configurable) with per-lang speed
    """
    if speaker_wav:
        print("🎙 Using XTTS v2 with speaker_wav (voice cloning).")
        xtts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")

        def synth(seg_text, lang, out_file):
            # XTTS usually ignores 'speed', so keep it simple
            xtts.tts_to_file(text=seg_text, language=lang, speaker_wav=speaker_wav, file_path=str(out_file))
        return synth

    print("🗣 Using per-language single-speaker models (no recording).")
    cache = {"en": None, "zh": None}

    # Defaults (overridable by CLI)
    en_model = en_model or "tts_models/en/ljspeech/glow-tts"
    zh_model = zh_model or "tts_models/zh-CN/baker/vits"  # prefer VITS for better duration
    # On some setups, zh VITS may be unavailable; we'll fallback to Tacotron2-GST.

    def ensure_model(lang: str):
        if lang == "en":
            if cache["en"] is None:
                cache["en"] = TTS(en_model)
            return cache["en"]
        elif lang == "zh":
            if cache["zh"] is None:
                try:
                    cache["zh"] = TTS(zh_model)
                except Exception:
                    print(f"⚠️ Failed to load {zh_model}, falling back to 'tts_models/zh-CN/baker/tacotron2-DDC-GST'")
                    cache["zh"] = TTS("tts_models/zh-CN/baker/tacotron2-DDC-GST")
            return cache["zh"]
        else:
            raise ValueError(f"Unsupported language: {lang}")

    def synth(seg_text, lang, out_file):
        model = ensure_model(lang)
        try:
            spd = zh_speed if lang == "zh" else en_speed
            model.tts_to_file(text=seg_text, file_path=str(out_file), speed=spd)
        except TypeError:
            # If model doesn't accept 'speed', call without it
            model.tts_to_file(text=seg_text, file_path=str(out_file))

    return synth


# ---------------------- Pipeline ----------------------

def synthesize_segments(
    text: str,
    out_path: str,
    speaker_wav: str | None,
    zh_model: str | None,
    en_model: str | None,
    zh_speed: float,
    en_speed: float,
):
    chunks = segment_runs(text)
    if not chunks:
        raise ValueError("No text found after segmentation.")

    print(f"Detected {len(chunks)} segment(s):")
    for i, c in enumerate(chunks, 1):
        print(f"  [{i}] ({lang_of(c)}) {c[:80]!r}{'...' if len(c) > 80 else ''}")

    synth = get_tts_backend(speaker_wav, zh_model, en_model, zh_speed, en_speed)

    tmpdir = Path(tempfile.mkdtemp(prefix="vivid_tts_"))
    piece_paths = []
    try:
        for i, seg in enumerate(chunks, 1):
            lang = lang_of(seg)
            piece = tmpdir / f"piece_{i:03d}_{lang}.wav"
            print(f"\n🎧 Synthesizing segment {i}/{len(chunks)} [{lang}] → {piece.name}")
            synth(seg, lang, piece)
            piece_paths.append(piece)

        print("\n🔗 Merging segments into one audio...")
        combined = AudioSegment.silent(duration=0)
        for p in piece_paths:
            combined += AudioSegment.from_file(p)          # WAV reading OK without ffmpeg
            combined += AudioSegment.silent(duration=80)   # small spacer

        out_path = Path(out_path).with_suffix(".wav")
        combined.export(out_path, format="wav")
        print(f"\n✅ Done! Final audio saved to: {out_path.resolve()}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ---------------------- CLI ----------------------

def main():
    ap = argparse.ArgumentParser(description="Multilingual TTS (EN/ZH) with segmentation and merging.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--text", type=str, help="Inline text to synthesize.")
    g.add_argument("--textfile", type=str, help="Path to a UTF-8 text file.")

    ap.add_argument("--out", type=str, default="final_output.wav", help="Output WAV path.")
    ap.add_argument("--speaker_wav", type=str, help="Use XTTS v2 cloning with a reference WAV/MP3 (same voice across languages).")

    # Model overrides & speeds
    ap.add_argument("--zh_model", type=str, help="Override zh model (e.g., tts_models/zh-CN/baker/vits)")
    ap.add_argument("--en_model", type=str, help="Override en model (e.g., tts_models/en/ljspeech/glow-tts)")
    ap.add_argument("--zh_speed", type=float, default=1.3, help="Speed for zh segments (default 1.3)")
    ap.add_argument("--en_speed", type=float, default=1.0, help="Speed for en segments (default 1.0)")

    args = ap.parse_args()

    # Load text
    if args.textfile:
        if not os.path.isfile(args.textfile):
            sys.exit(f"❌ Text file not found: {args.textfile}")
        text = Path(args.textfile).read_text(encoding="utf-8")
    else:
        text = args.text or ""

    if not text.strip():
        sys.exit("❌ No text provided.")
    if args.speaker_wav and not os.path.isfile(args.speaker_wav):
        sys.exit(f"❌ speaker_wav not found: {args.speaker_wav}")

    synthesize_segments(
        text=text.strip(),
        out_path=args.out,
        speaker_wav=args.speaker_wav,
        zh_model=args.zh_model,
        en_model=args.en_model,
        zh_speed=args.zh_speed,
        en_speed=args.en_speed,
    )

if __name__ == "__main__":
    main()

#!/usr/bin/env python
# Word-level captions in pt-BR with faster-whisper ("base", multilingual).
# Never use a .en model: it translates non-English audio into English.
# Usage:
#   .venv/Scripts/python captions_pt.py --words words.json [--segments segs.json] a.wav@0.0 b.wav@5.2
# Each input is "file[@offset_s]"; the offset is where that clip starts on the video timeline.
# --download fetches the model into models/whisper (setup only; generation runs never download).

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

MODEL_REPO = "Systran/faster-whisper-base"
SAMPLE_RATE = 16000


def parse_input(item):
    path, sep, offset = item.rpartition("@")
    if not sep:
        return item, 0.0
    return path, float(offset)


def decode_audio(path):
    # Decode with FFmpeg (already a pipeline requirement) instead of PyAV, whose
    # open() signature changed between releases and breaks faster-whisper 1.2.x.
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True,
    )
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed on {path}: {result.stderr.decode(errors='replace')}")
    return np.frombuffer(result.stdout, dtype=np.float32)


def load_model(models_dir, download):
    model_dir = Path(models_dir)
    if not (model_dir / "model.bin").exists():
        if not download:
            sys.exit(f"Whisper 'base' missing in {model_dir}. Run once with --download (setup).")
        from huggingface_hub import snapshot_download

        snapshot_download(MODEL_REPO, local_dir=model_dir)
    return WhisperModel(str(model_dir), device="cpu", compute_type="int8")


def write_json(path, data):
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="pt-BR word-level captions (faster-whisper base)")
    parser.add_argument("inputs", nargs="*", help="file[@offset_s], one per scene")
    parser.add_argument("--words", help="output: [{text, start, end}] per word")
    parser.add_argument("--segments", help="optional output in whisper segment shape (for normalize-transcript.mjs)")
    parser.add_argument("--models", default="models/whisper")
    parser.add_argument("--download", action="store_true", help="fetch the model if missing (setup only)")
    args = parser.parse_args()

    if not args.inputs and not args.download:
        parser.error("pass at least one audio file")
    if args.inputs and not args.words:
        parser.error("--words is required when transcribing")

    model = load_model(args.models, args.download)
    if not args.inputs:
        print(f"model ready in {args.models}")
        return

    words, segments = [], []
    for item in args.inputs:
        path, offset = parse_input(item)
        if not Path(path).exists():
            sys.exit(f"audio not found: {path}")
        # language is fixed so Whisper never guesses another language
        segment_iter, _info = model.transcribe(decode_audio(path), language="pt", word_timestamps=True)
        for seg in segment_iter:
            segments.append({
                "id": len(segments) + 1,
                "start": round(seg.start + offset, 3),
                "end": round(seg.end + offset, 3),
                "text": seg.text.strip(),
            })
            for w in seg.words or []:
                text = w.word.strip()
                if text:
                    words.append({
                        "text": text,
                        "start": round(w.start + offset, 3),
                        "end": round(w.end + offset, 3),
                    })

    write_json(args.words, words)
    if args.segments:
        write_json(args.segments, {"segments": segments})
    print(f"{len(words)} words from {len(args.inputs)} file(s) -> {args.words}")


if __name__ == "__main__":
    main()

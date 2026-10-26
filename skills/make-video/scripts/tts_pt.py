#!/usr/bin/env python
# pt-BR narration, fully local: Kokoro-82M through kokoro-onnx (CPU).
# The weights must already be in models/kokoro/ (setup step); nothing is downloaded here.
# Usage: .venv/Scripts/python tts_pt.py <text.txt> --out <out.wav> [--voice pf_dora] [--speed 1.0]
# pt-BR voices in Kokoro v1.0: pf_dora (female, default), pm_alex and pm_santa (male).

import argparse
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

PT_BR_VOICES = ["pf_dora", "pm_alex", "pm_santa"]


def main():
    parser = argparse.ArgumentParser(description="pt-BR narration with local Kokoro")
    parser.add_argument("text_file")
    parser.add_argument("--out", required=True)
    parser.add_argument("--voice", default="pf_dora", choices=PT_BR_VOICES)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--models", default="models/kokoro")
    args = parser.parse_args()

    models = Path(args.models)
    model_file = models / "kokoro-v1.0.onnx"
    voices_file = models / "voices-v1.0.bin"
    if not (model_file.exists() and voices_file.exists()):
        sys.exit(f"Kokoro weights missing in {models}. Run the setup in pacote-video-motion.md.")

    text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not text:
        sys.exit(f"empty text: {args.text_file}")

    kokoro = Kokoro(str(model_file), str(voices_file))
    # lang selects the espeak-ng phonemizer (pt-br)
    samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang="pt-br")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), samples, sample_rate)
    print(f"{out} {len(samples) / sample_rate:.2f}s")


if __name__ == "__main__":
    main()

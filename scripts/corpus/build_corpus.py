"""Build a single-episode bilingual corpus from one SRT file."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from parse_srt import SrtParseError, SubtitleCue, parse_srt_file


class CorpusBuildError(ValueError):
    """Raised when a parsed cue cannot become a dialogue segment."""


@dataclass(frozen=True, slots=True)
class DialogueSegment:
    sequence: int
    start_ms: int
    end_ms: int
    speaker: None
    text_zh: str | None
    text_en: str | None
    normalized_zh: str | None
    normalized_en: str | None
    alignment_confidence: None


_CONTROL_TAG_PATTERN = re.compile(r"\{[^{}]*\}")
_CJK_PATTERN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_WHITESPACE_PATTERN = re.compile(r"\s+")
_UNICODE_APOSTROPHES = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u02bc": "'",
        "\uff07": "'",
    }
)


def clean_subtitle_line(line: str) -> str:
    """Remove simple ASS/SSA override blocks and collapse whitespace."""

    return collapse_whitespace(_CONTROL_TAG_PATTERN.sub("", line))


def collapse_whitespace(text: str) -> str:
    return _WHITESPACE_PATTERN.sub(" ", text).strip()


def normalize_english(text: str) -> str:
    return collapse_whitespace(text.translate(_UNICODE_APOSTROPHES)).lower()


def normalize_chinese(text: str) -> str:
    return collapse_whitespace(text)


def split_languages(lines: Iterable[str]) -> tuple[str | None, str | None]:
    """Classify cleaned lines deterministically by the presence of CJK text."""

    chinese_lines: list[str] = []
    english_lines: list[str] = []

    for raw_line in lines:
        line = clean_subtitle_line(raw_line)
        if not line:
            continue
        if _CJK_PATTERN.search(line):
            chinese_lines.append(line)
        else:
            english_lines.append(line)

    text_zh = " ".join(chinese_lines) or None
    text_en = " ".join(english_lines) or None
    return text_zh, text_en


def build_segment(cue: SubtitleCue) -> DialogueSegment:
    text_zh, text_en = split_languages(cue.lines)
    if text_zh is None and text_en is None:
        raise CorpusBuildError(
            f"Cue {cue.sequence} has no text after subtitle control tags are removed"
        )

    return DialogueSegment(
        sequence=cue.sequence,
        start_ms=cue.start_ms,
        end_ms=cue.end_ms,
        speaker=None,
        text_zh=text_zh,
        text_en=text_en,
        normalized_zh=normalize_chinese(text_zh) if text_zh is not None else None,
        normalized_en=normalize_english(text_en) if text_en is not None else None,
        alignment_confidence=None,
    )


def build_documents(
    episode: str, cues: Iterable[SubtitleCue]
) -> tuple[dict[str, object], dict[str, object]]:
    if not episode.strip():
        raise CorpusBuildError("Episode slug must not be empty")

    segments = [build_segment(cue) for cue in cues]
    if not segments:
        raise CorpusBuildError("Corpus must contain at least one segment")

    bilingual = sum(
        segment.text_zh is not None and segment.text_en is not None
        for segment in segments
    )
    english_only = sum(
        segment.text_en is not None and segment.text_zh is None
        for segment in segments
    )
    chinese_only = sum(
        segment.text_zh is not None and segment.text_en is None
        for segment in segments
    )

    corpus: dict[str, object] = {
        "episode": episode,
        "segments": [asdict(segment) for segment in segments],
    }
    manifest: dict[str, object] = {
        "episode": episode,
        "source": {"type": "bilingual_srt"},
        "cues": len(segments),
        "segments": len(segments),
        "bilingual": bilingual,
        "english_only": english_only,
        "chinese_only": chinese_only,
        "invalid": 0,
        "version": 1,
    }
    return corpus, manifest


def write_json(path: Path, document: dict[str, object]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as error:
        raise CorpusBuildError(f"Unable to write JSON output {path}: {error}") from error


def build_corpus_files(
    episode: str, subtitle_path: Path, output_path: Path, manifest_path: Path
) -> tuple[dict[str, object], dict[str, object]]:
    cues = parse_srt_file(subtitle_path)
    corpus, manifest = build_documents(episode, cues)
    write_json(output_path, corpus)
    write_json(manifest_path, manifest)
    return corpus, manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build one bilingual subtitle corpus from an SRT file."
    )
    parser.add_argument("--episode", required=True, help="Episode slug, e.g. tbbt-s01e01")
    parser.add_argument("--subtitle", required=True, type=Path, help="Bilingual SRT input")
    parser.add_argument("--output", required=True, type=Path, help="segments.json output")
    parser.add_argument("--manifest", required=True, type=Path, help="manifest JSON output")
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    args = parse_args()
    try:
        _, manifest = build_corpus_files(
            args.episode, args.subtitle, args.output, args.manifest
        )
    except (CorpusBuildError, SrtParseError) as error:
        raise SystemExit(f"Error: {error}") from error

    print(
        f"Built {manifest['segments']} segments for {manifest['episode']} "
        f"({manifest['bilingual']} bilingual, "
        f"{manifest['english_only']} English only, "
        f"{manifest['chinese_only']} Chinese only)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

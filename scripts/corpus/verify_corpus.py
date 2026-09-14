"""Validate a generated corpus and print optional review samples."""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class CorpusVerificationError(ValueError):
    """Raised when a corpus file cannot be loaded for verification."""


@dataclass(frozen=True, slots=True)
class VerificationReport:
    episode: str
    segments: int
    bilingual: int
    english_only: int
    chinese_only: int
    invalid: int
    errors: tuple[str, ...]

    @property
    def is_valid(self) -> bool:
        return not self.errors


def _is_positive_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _is_nonnegative_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _has_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def verify_corpus(document: object) -> VerificationReport:
    if not isinstance(document, dict):
        raise CorpusVerificationError("Corpus root must be a JSON object")

    episode_value = document.get("episode")
    episode = episode_value if isinstance(episode_value, str) else ""
    root_errors: list[str] = []
    if not episode.strip():
        root_errors.append("Corpus episode must be a non-empty string")

    segments_value = document.get("segments")
    if not isinstance(segments_value, list):
        raise CorpusVerificationError("Corpus segments must be a JSON array")

    if not segments_value:
        root_errors.append("Corpus must contain at least one segment")

    errors = list(root_errors)
    invalid_indexes: set[int] = set()
    seen_sequences: set[int] = set()
    bilingual = 0
    english_only = 0
    chinese_only = 0

    for index, value in enumerate(segments_value):
        label = f"Segment #{index + 1}"
        segment_errors: list[str] = []
        if not isinstance(value, dict):
            errors.append(f"{label} must be a JSON object")
            invalid_indexes.add(index)
            continue

        sequence = value.get("sequence")
        if not _is_positive_integer(sequence):
            segment_errors.append("sequence must be a positive integer")
        elif sequence in seen_sequences:
            segment_errors.append(f"sequence {sequence} is duplicated")
        else:
            seen_sequences.add(sequence)

        start_ms = value.get("start_ms")
        end_ms = value.get("end_ms")
        if not _is_nonnegative_integer(start_ms):
            segment_errors.append("start_ms must be a non-negative integer")
        if not _is_nonnegative_integer(end_ms) or (
            _is_nonnegative_integer(start_ms) and end_ms <= start_ms
        ):
            segment_errors.append("end_ms must be an integer greater than start_ms")

        text_en = _has_text(value.get("text_en"))
        text_zh = _has_text(value.get("text_zh"))
        normalized_en = _has_text(value.get("normalized_en"))
        normalized_zh = _has_text(value.get("normalized_zh"))

        if not text_en and not text_zh:
            segment_errors.append("text_en or text_zh must contain text")
        if text_en != normalized_en:
            segment_errors.append(
                "normalized_en presence must match text_en presence"
            )
        if text_zh != normalized_zh:
            segment_errors.append(
                "normalized_zh presence must match text_zh presence"
            )

        if "speaker" not in value or value.get("speaker") is not None:
            segment_errors.append("speaker must be null")
        if (
            "alignment_confidence" not in value
            or value.get("alignment_confidence") is not None
        ):
            segment_errors.append("alignment_confidence must be null")

        if text_en and text_zh:
            bilingual += 1
        elif text_en:
            english_only += 1
        elif text_zh:
            chinese_only += 1

        if segment_errors:
            invalid_indexes.add(index)
            errors.extend(f"{label}: {message}" for message in segment_errors)

    return VerificationReport(
        episode=episode,
        segments=len(segments_value),
        bilingual=bilingual,
        english_only=english_only,
        chinese_only=chinese_only,
        invalid=len(invalid_indexes),
        errors=tuple(errors),
    )


def load_corpus(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise CorpusVerificationError(f"Unable to read corpus JSON {path}: {error}") from error
    if not isinstance(document, dict):
        raise CorpusVerificationError("Corpus root must be a JSON object")
    return document


def format_timestamp(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def print_report(
    report: VerificationReport,
    segments: list[dict[str, Any]],
    sample_count: int,
    seed: int | None,
) -> None:
    print(f"Episode: {report.episode}")
    print(f"Segments: {report.segments}")
    print(f"Bilingual: {report.bilingual}")
    print(f"English only: {report.english_only}")
    print(f"Chinese only: {report.chinese_only}")
    print(f"Invalid: {report.invalid}")

    if sample_count <= 0 or not segments:
        return

    generator = random.Random(seed)
    for segment in generator.sample(segments, min(sample_count, len(segments))):
        print()
        print(f"Random sample #{segment['sequence']}")
        print(
            f"{format_timestamp(segment['start_ms'])} -> "
            f"{format_timestamp(segment['end_ms'])}"
        )
        print(f"ZH: {segment.get('text_zh') or '-'}")
        print(f"EN: {segment.get('text_en') or '-'}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify a generated single-episode corpus."
    )
    parser.add_argument("corpus", type=Path, help="Path to segments.json")
    parser.add_argument("--samples", type=int, default=30, help="Review sample count")
    parser.add_argument("--seed", type=int, help="Optional reproducible sample seed")
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    if args.samples < 0:
        raise SystemExit("Error: --samples must be non-negative")

    try:
        document = load_corpus(args.corpus)
        report = verify_corpus(document)
    except CorpusVerificationError as error:
        raise SystemExit(f"Error: {error}") from error

    segments = document["segments"]
    if report.is_valid:
        print_report(report, segments, args.samples, args.seed)
        return 0

    print_report(report, [], 0, args.seed)
    for error in report.errors:
        print(f"Error: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

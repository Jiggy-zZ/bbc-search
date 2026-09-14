"""Verify generated MP4 clips against their Phase 3 manifest."""

from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from generate_clips import ClipGenerationError, probe_media_duration_ms


DURATION_TOLERANCE_MS = 250

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
ToolResolver = Callable[[str], str | None]


class ClipVerificationError(ValueError):
    """Raised when a clip manifest cannot be safely verified."""


@dataclass(frozen=True, slots=True)
class ClipVerificationReport:
    episode: str
    manifest_entries: int
    valid: int
    missing: int
    invalid: int
    errors: tuple[str, ...]
    reviewed_entries: tuple[dict[str, Any], ...]

    @property
    def is_valid(self) -> bool:
        return not self.errors and self.valid == self.manifest_entries


def _is_positive_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _is_nonnegative_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def load_clip_manifest(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ClipVerificationError(f"Unable to read clip manifest {path}: {error}") from error
    if not isinstance(document, dict):
        raise ClipVerificationError("Clip manifest root must be an object")
    return document


def require_ffprobe(resolver: ToolResolver = shutil.which) -> str:
    ffprobe = resolver("ffprobe")
    if not ffprobe:
        raise ClipVerificationError(
            "FFprobe executable not found. Install FFmpeg and ensure ffprobe is available in PATH."
        )
    return ffprobe


def _resolve_clip_path(manifest_path: Path, relative_file: str) -> Path:
    relative_path = Path(relative_file)
    if relative_path.is_absolute():
        raise ClipVerificationError("Clip manifest file paths must be relative")

    manifest_root = manifest_path.parent.resolve()
    clip_path = (manifest_root / relative_path).resolve()
    if not clip_path.is_relative_to(manifest_root):
        raise ClipVerificationError("Clip manifest file path leaves the manifest directory")
    return clip_path


def verify_clip_files(
    manifest_path: Path,
    *,
    resolver: ToolResolver = shutil.which,
    runner: CommandRunner = subprocess.run,
) -> ClipVerificationReport:
    document = load_clip_manifest(manifest_path)
    episode = document.get("episode")
    if not isinstance(episode, str) or not episode.strip():
        raise ClipVerificationError("Clip manifest episode must be a non-empty string")

    entries = document.get("clips")
    if not isinstance(entries, list) or not entries:
        raise ClipVerificationError("Clip manifest must contain a non-empty clips array")

    ffprobe = require_ffprobe(resolver)
    errors: list[str] = []
    reviewed_entries: list[dict[str, Any]] = []
    seen_sequences: set[int] = set()
    seen_files: set[str] = set()
    valid = 0
    missing = 0
    invalid = 0

    for index, value in enumerate(entries, start=1):
        label = f"Clip entry #{index}"
        entry_errors: list[str] = []
        if not isinstance(value, dict):
            errors.append(f"{label} must be an object")
            invalid += 1
            continue

        sequence = value.get("sequence")
        relative_file = value.get("file")
        clip_start_ms = value.get("clip_start_ms")
        clip_end_ms = value.get("clip_end_ms")
        duration_ms = value.get("duration_ms")

        if not _is_positive_integer(sequence):
            entry_errors.append("sequence must be a positive integer")
        elif sequence in seen_sequences:
            entry_errors.append(f"sequence {sequence} is duplicated")
        else:
            seen_sequences.add(sequence)

        if not isinstance(relative_file, str) or not relative_file.strip():
            entry_errors.append("file must be a non-empty relative path")
            clip_path = None
        else:
            if relative_file in seen_files:
                entry_errors.append(f"file {relative_file!r} is duplicated")
            seen_files.add(relative_file)
            try:
                clip_path = _resolve_clip_path(manifest_path, relative_file)
            except ClipVerificationError as error:
                entry_errors.append(str(error))
                clip_path = None

        if not _is_nonnegative_integer(clip_start_ms):
            entry_errors.append("clip_start_ms must be a non-negative integer")
        if (
            not _is_positive_integer(clip_end_ms)
            or _is_nonnegative_integer(clip_start_ms)
            and clip_end_ms <= clip_start_ms
        ):
            entry_errors.append("clip_end_ms must be greater than clip_start_ms")
        if not _is_positive_integer(duration_ms):
            entry_errors.append("duration_ms must be a positive integer")
        elif (
            _is_nonnegative_integer(clip_start_ms)
            and _is_positive_integer(clip_end_ms)
            and duration_ms != clip_end_ms - clip_start_ms
        ):
            entry_errors.append("duration_ms must equal clip_end_ms - clip_start_ms")

        file_missing = False
        if clip_path is not None:
            if not clip_path.is_file():
                entry_errors.append(f"clip file is missing: {relative_file}")
                file_missing = True
            elif clip_path.stat().st_size <= 0:
                entry_errors.append(f"clip file is empty: {relative_file}")
            elif _is_positive_integer(duration_ms):
                try:
                    probed_duration_ms = probe_media_duration_ms(
                        clip_path, ffprobe, runner
                    )
                except ClipGenerationError as error:
                    entry_errors.append(str(error))
                else:
                    difference = abs(probed_duration_ms - duration_ms)
                    if difference > DURATION_TOLERANCE_MS:
                        entry_errors.append(
                            f"duration differs by {difference} ms (tolerance "
                            f"{DURATION_TOLERANCE_MS} ms)"
                        )

        if entry_errors:
            if file_missing:
                missing += 1
            else:
                invalid += 1
            errors.extend(f"{label}: {message}" for message in entry_errors)
        else:
            valid += 1
            reviewed_entries.append(value)

    return ClipVerificationReport(
        episode=episode,
        manifest_entries=len(entries),
        valid=valid,
        missing=missing,
        invalid=invalid,
        errors=tuple(errors),
        reviewed_entries=tuple(reviewed_entries),
    )


def print_report(
    report: ClipVerificationReport, sample_count: int, seed: int | None
) -> None:
    print(f"Episode: {report.episode}")
    print(f"Manifest entries: {report.manifest_entries}")
    print(f"Valid: {report.valid}")
    print(f"Missing: {report.missing}")
    print(f"Invalid: {report.invalid}")

    if sample_count <= 0 or not report.reviewed_entries:
        return

    generator = random.Random(seed)
    samples = generator.sample(
        report.reviewed_entries, min(sample_count, len(report.reviewed_entries))
    )
    for entry in samples:
        print()
        print(f"Review sample #{entry['sequence']}: {entry['file']}")
        print(
            f"Timing: {entry['clip_start_ms']} -> {entry['clip_end_ms']} ms "
            f"({entry['duration_ms']} ms)"
        )


def _nonnegative_samples(value: str) -> int:
    try:
        samples = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a non-negative integer") from error
    if samples < 0:
        raise argparse.ArgumentTypeError("must be a non-negative integer")
    return samples


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify Phase 3 generated clips.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--samples", type=_nonnegative_samples, default=15)
    parser.add_argument("--seed", type=int)
    return parser.parse_args(argv)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    try:
        report = verify_clip_files(args.manifest)
    except ClipVerificationError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print_report(report, args.samples, args.seed)
    if report.is_valid:
        return 0

    for error in report.errors:
        print(f"Error: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

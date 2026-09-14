"""Generate one browser-playable MP4 clip for each dialogue segment."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable, Sequence


BEFORE_PADDING_MS = 1_500
AFTER_PADDING_MS = 2_000

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]
ToolResolver = Callable[[str], str | None]


class ClipGenerationError(ValueError):
    """Raised when clip generation cannot safely continue."""


class ClipGenerationFailure(ClipGenerationError):
    """Raised when FFmpeg fails while processing a specific segment."""

    def __init__(
        self, sequence: int, generated: int, skipped: int, detail: str
    ) -> None:
        super().__init__(f"Clip generation failed for sequence {sequence}: {detail}")
        self.sequence = sequence
        self.generated = generated
        self.skipped = skipped


@dataclass(frozen=True, slots=True)
class SegmentTiming:
    sequence: int
    start_ms: int
    end_ms: int


@dataclass(frozen=True, slots=True)
class ClipTiming:
    sequence: int
    clip_start_ms: int
    clip_end_ms: int
    duration_ms: int


@dataclass(frozen=True, slots=True)
class ClipManifestEntry:
    sequence: int
    file: str
    clip_start_ms: int
    clip_end_ms: int
    duration_ms: int


@dataclass(frozen=True, slots=True)
class GenerationResult:
    manifest: dict[str, object]
    generated: int
    skipped: int


def _is_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def clip_filename(sequence: int) -> str:
    if not _is_integer(sequence) or sequence <= 0:
        raise ClipGenerationError("Clip sequence must be a positive integer")
    return f"{sequence:04d}.mp4"


def calculate_clip_timing(
    segment: SegmentTiming, video_duration_ms: int
) -> ClipTiming:
    if not _is_integer(video_duration_ms) or video_duration_ms <= 0:
        raise ClipGenerationError("Source video duration must be a positive integer")
    if (
        not _is_integer(segment.start_ms)
        or segment.start_ms < 0
        or not _is_integer(segment.end_ms)
        or segment.end_ms <= segment.start_ms
    ):
        raise ClipGenerationError(
            f"Segment {segment.sequence} has invalid start_ms/end_ms timing"
        )

    clip_start_ms = max(0, segment.start_ms - BEFORE_PADDING_MS)
    clip_end_ms = min(video_duration_ms, segment.end_ms + AFTER_PADDING_MS)
    if clip_end_ms <= clip_start_ms:
        raise ClipGenerationError(
            f"Segment {segment.sequence} falls outside the source video duration"
        )

    return ClipTiming(
        sequence=segment.sequence,
        clip_start_ms=clip_start_ms,
        clip_end_ms=clip_end_ms,
        duration_ms=clip_end_ms - clip_start_ms,
    )


def load_segments(path: Path, expected_episode: str) -> list[SegmentTiming]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ClipGenerationError(f"Unable to read segments JSON {path}: {error}") from error

    if not isinstance(document, dict):
        raise ClipGenerationError("Segments JSON root must be an object")
    if document.get("episode") != expected_episode:
        raise ClipGenerationError(
            f"Segments episode does not match --episode {expected_episode!r}"
        )

    values = document.get("segments")
    if not isinstance(values, list) or not values:
        raise ClipGenerationError("Segments JSON must contain a non-empty segments array")

    segments: list[SegmentTiming] = []
    seen_sequences: set[int] = set()
    for index, value in enumerate(values, start=1):
        if not isinstance(value, dict):
            raise ClipGenerationError(f"Segment #{index} must be an object")

        sequence = value.get("sequence")
        start_ms = value.get("start_ms")
        end_ms = value.get("end_ms")
        if not _is_integer(sequence) or sequence <= 0:
            raise ClipGenerationError(
                f"Segment #{index} sequence must be a positive integer"
            )
        if sequence in seen_sequences:
            raise ClipGenerationError(f"Segment sequence {sequence} is duplicated")
        seen_sequences.add(sequence)

        if (
            not _is_integer(start_ms)
            or start_ms < 0
            or not _is_integer(end_ms)
            or end_ms <= start_ms
        ):
            raise ClipGenerationError(
                f"Segment {sequence} has invalid start_ms/end_ms timing"
            )
        segments.append(SegmentTiming(sequence, start_ms, end_ms))

    return segments


def require_media_tools(
    resolver: ToolResolver = shutil.which,
) -> tuple[str, str]:
    ffmpeg = resolver("ffmpeg")
    if not ffmpeg:
        raise ClipGenerationError(
            "FFmpeg executable not found. Install FFmpeg and ensure "
            "ffmpeg/ffprobe are available in PATH."
        )

    ffprobe = resolver("ffprobe")
    if not ffprobe:
        raise ClipGenerationError(
            "FFprobe executable not found. Install FFmpeg and ensure "
            "ffmpeg/ffprobe are available in PATH."
        )
    return ffmpeg, ffprobe


def probe_media_duration_ms(
    media_path: Path,
    ffprobe: str,
    runner: CommandRunner = subprocess.run,
) -> int:
    command = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    try:
        result = runner(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as error:
        raise ClipGenerationError(
            f"Unable to run FFprobe for {media_path.name}: {error}"
        ) from error
    if result.returncode != 0:
        detail = _last_error_line(result.stderr)
        raise ClipGenerationError(f"FFprobe could not read {media_path.name}: {detail}")

    try:
        duration = Decimal(result.stdout.strip())
        duration_ms = int((duration * 1000).quantize(Decimal("1"), ROUND_HALF_UP))
    except (InvalidOperation, ValueError) as error:
        raise ClipGenerationError(
            f"FFprobe returned an invalid duration for {media_path.name}"
        ) from error

    if duration_ms <= 0:
        raise ClipGenerationError(
            f"FFprobe returned a non-positive duration for {media_path.name}"
        )
    return duration_ms


def _last_error_line(stderr: str | None) -> str:
    lines = [line.strip() for line in (stderr or "").splitlines() if line.strip()]
    return lines[-1] if lines else "unknown FFmpeg error"


def _seconds(milliseconds: int) -> str:
    seconds, millis = divmod(milliseconds, 1000)
    return f"{seconds}.{millis:03d}"


def transcode_clip(
    video_path: Path,
    output_path: Path,
    timing: ClipTiming,
    ffmpeg: str,
    runner: CommandRunner = subprocess.run,
) -> None:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        _seconds(timing.clip_start_ms),
        "-i",
        str(video_path),
        "-t",
        _seconds(timing.duration_ms),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-vf",
        "scale=-2:480",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        "-y",
        str(output_path),
    ]
    try:
        result = runner(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as error:
        output_path.unlink(missing_ok=True)
        raise ClipGenerationError(f"Unable to run FFmpeg: {error}") from error
    if result.returncode != 0:
        output_path.unlink(missing_ok=True)
        raise ClipGenerationError(_last_error_line(result.stderr))
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        output_path.unlink(missing_ok=True)
        raise ClipGenerationError("FFmpeg completed without producing a non-empty clip")


def _relative_manifest_path(path: Path, manifest_path: Path) -> str:
    return Path(os.path.relpath(path, manifest_path.parent)).as_posix()


def write_manifest(path: Path, manifest: dict[str, object]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as error:
        raise ClipGenerationError(f"Unable to write clip manifest {path}: {error}") from error


def generate_clip_files(
    *,
    episode: str,
    video_path: Path,
    segments_path: Path,
    output_directory: Path,
    manifest_path: Path,
    limit: int | None = None,
    overwrite: bool = False,
    resolver: ToolResolver = shutil.which,
    runner: CommandRunner = subprocess.run,
) -> GenerationResult:
    if not episode.strip():
        raise ClipGenerationError("Episode slug must not be empty")
    if not video_path.is_file():
        raise ClipGenerationError(f"Source video not found: {video_path}")
    if limit is not None and (not _is_integer(limit) or limit <= 0):
        raise ClipGenerationError("--limit must be a positive integer")

    segments = load_segments(segments_path, episode)
    ffmpeg, ffprobe = require_media_tools(resolver)
    video_duration_ms = probe_media_duration_ms(video_path, ffprobe, runner)
    selected_segments = segments[:limit] if limit is not None else segments

    manifest_root = manifest_path.parent.resolve()
    if not output_directory.resolve().is_relative_to(manifest_root):
        raise ClipGenerationError(
            "Clip output directory must be inside the manifest directory"
        )
    try:
        output_directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ClipGenerationError(
            f"Unable to create clip output directory {output_directory}: {error}"
        ) from error
    generated = 0
    skipped = 0
    entries: list[ClipManifestEntry] = []

    for segment in selected_segments:
        timing = calculate_clip_timing(segment, video_duration_ms)
        output_path = output_directory / clip_filename(segment.sequence)
        if output_path.exists() and not overwrite:
            if not output_path.is_file():
                raise ClipGenerationFailure(
                    segment.sequence,
                    generated,
                    skipped,
                    f"existing clip path is not a file: {output_path}",
                )
            skipped += 1
        else:
            try:
                transcode_clip(video_path, output_path, timing, ffmpeg, runner)
            except (ClipGenerationError, OSError) as error:
                raise ClipGenerationFailure(
                    segment.sequence, generated, skipped, str(error)
                ) from error
            generated += 1

        entries.append(
            ClipManifestEntry(
                sequence=segment.sequence,
                file=_relative_manifest_path(output_path, manifest_path),
                clip_start_ms=timing.clip_start_ms,
                clip_end_ms=timing.clip_end_ms,
                duration_ms=timing.duration_ms,
            )
        )

    manifest: dict[str, object] = {
        "episode": episode,
        "source_video": video_path.name,
        "video_duration_ms": video_duration_ms,
        "padding": {
            "before_ms": BEFORE_PADDING_MS,
            "after_ms": AFTER_PADDING_MS,
        },
        "clips": [asdict(entry) for entry in entries],
    }
    write_manifest(manifest_path, manifest)
    return GenerationResult(manifest=manifest, generated=generated, skipped=skipped)


def _positive_limit(value: str) -> int:
    try:
        limit = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if limit <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return limit


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate one MP4 clip per Phase 2 dialogue segment."
    )
    parser.add_argument("--episode", required=True)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--segments", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--limit", type=_positive_limit)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args(argv)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    try:
        result = generate_clip_files(
            episode=args.episode,
            video_path=args.video,
            segments_path=args.segments,
            output_directory=args.output,
            manifest_path=args.manifest,
            limit=args.limit,
            overwrite=args.overwrite,
        )
    except ClipGenerationFailure as error:
        print(f"Error: {error}", file=sys.stderr)
        print(f"Generated: {error.generated}", file=sys.stderr)
        print(f"Skipped:   {error.skipped}", file=sys.stderr)
        print("Failed:    1", file=sys.stderr)
        return 1
    except ClipGenerationError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Generated: {result.generated}")
    print(f"Skipped:   {result.skipped}")
    print("Failed:    0")
    print(f"Manifest:  {args.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

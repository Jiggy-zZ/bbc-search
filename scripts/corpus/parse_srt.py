"""Parse standard SRT subtitle data into timestamped cues."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


class SrtParseError(ValueError):
    """Raised when SRT input is structurally invalid."""


@dataclass(frozen=True, slots=True)
class SubtitleCue:
    sequence: int
    start_ms: int
    end_ms: int
    lines: tuple[str, ...]


_TIMESTAMP_PATTERN = re.compile(
    r"(?P<start>\d{2,}:\d{2}:\d{2},\d{3})\s*-->\s*"
    r"(?P<end>\d{2,}:\d{2}:\d{2},\d{3})"
)
_BLOCK_SEPARATOR = re.compile(r"\n[ \t]*\n(?:[ \t]*\n)*")


def parse_timestamp(value: str) -> int:
    """Convert an SRT timestamp to integer milliseconds."""

    match = re.fullmatch(
        r"(?P<hours>\d{2,}):(?P<minutes>\d{2}):(?P<seconds>\d{2}),(?P<millis>\d{3})",
        value.strip(),
    )
    if not match:
        raise SrtParseError(f"Malformed SRT timestamp: {value!r}")

    parts = {name: int(number) for name, number in match.groupdict().items()}
    if parts["minutes"] > 59 or parts["seconds"] > 59:
        raise SrtParseError(f"Malformed SRT timestamp: {value!r}")

    return (
        ((parts["hours"] * 60 + parts["minutes"]) * 60 + parts["seconds"])
        * 1000
        + parts["millis"]
    )


def parse_srt_text(text: str) -> list[SubtitleCue]:
    """Parse SRT text while preserving every subtitle text line."""

    normalized = text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    stripped = normalized.strip(" \t\n")
    if not stripped:
        raise SrtParseError("SRT contains no cues")

    cues: list[SubtitleCue] = []
    for block_number, block in enumerate(_BLOCK_SEPARATOR.split(stripped), start=1):
        lines = block.split("\n")
        if len(lines) < 3:
            raise SrtParseError(
                f"Malformed SRT block {block_number}: expected sequence, timestamp, and text"
            )

        try:
            sequence = int(lines[0].strip())
        except ValueError as error:
            raise SrtParseError(
                f"Malformed SRT block {block_number}: invalid cue sequence"
            ) from error

        if sequence <= 0:
            raise SrtParseError(
                f"Malformed SRT block {block_number}: cue sequence must be positive"
            )

        timestamp_match = _TIMESTAMP_PATTERN.fullmatch(lines[1].strip())
        if not timestamp_match:
            raise SrtParseError(
                f"Malformed SRT block {block_number}: invalid timestamp range"
            )

        start_ms = parse_timestamp(timestamp_match.group("start"))
        end_ms = parse_timestamp(timestamp_match.group("end"))
        if end_ms <= start_ms:
            raise SrtParseError(
                f"Malformed SRT block {block_number}: end time must be after start time"
            )

        text_lines = tuple(lines[2:])
        if not any(line.strip() for line in text_lines):
            raise SrtParseError(f"Malformed SRT block {block_number}: cue has no text")

        cues.append(
            SubtitleCue(
                sequence=sequence,
                start_ms=start_ms,
                end_ms=end_ms,
                lines=text_lines,
            )
        )

    return cues


def parse_srt_file(path: Path) -> list[SubtitleCue]:
    """Read a UTF-8 or UTF-8 BOM SRT file and parse its cues."""

    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as error:
        raise SrtParseError(f"Unable to read SRT file {path}: {error}") from error

    return parse_srt_text(text)

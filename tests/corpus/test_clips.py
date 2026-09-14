from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CORPUS_SCRIPTS = PROJECT_ROOT / "scripts" / "corpus"
sys.path.insert(0, str(CORPUS_SCRIPTS))

from generate_clips import (  # noqa: E402
    AFTER_PADDING_MS,
    BEFORE_PADDING_MS,
    ClipGenerationError,
    ClipGenerationFailure,
    SegmentTiming,
    calculate_clip_timing,
    clip_filename,
    generate_clip_files,
    require_media_tools,
)
from verify_clips import verify_clip_files  # noqa: E402


class FakeMediaRunner:
    def __init__(self, duration_seconds: str = "10.000") -> None:
        self.duration_seconds = duration_seconds
        self.commands: list[list[str]] = []
        self.fail_ffmpeg = False

    def __call__(
        self, command: list[str], **_: Any
    ) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        if "ffprobe" in Path(command[0]).name:
            return subprocess.CompletedProcess(
                command, 0, stdout=f"{self.duration_seconds}\n", stderr=""
            )

        output = Path(command[-1])
        output.write_bytes(b"synthetic mp4 bytes")
        if self.fail_ffmpeg:
            return subprocess.CompletedProcess(
                command, 1, stdout="", stderr="synthetic encoding failure"
            )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")


def fake_tool_resolver(name: str) -> str:
    return str(Path("fake-tools") / f"{name}.exe")


class ClipTimingTests(unittest.TestCase):
    def test_calculates_normal_padded_boundaries(self) -> None:
        timing = calculate_clip_timing(SegmentTiming(1, 2_380, 4_840), 10_000)

        self.assertEqual(BEFORE_PADDING_MS, 1_500)
        self.assertEqual(AFTER_PADDING_MS, 2_000)
        self.assertEqual(timing.clip_start_ms, 880)
        self.assertEqual(timing.clip_end_ms, 6_840)
        self.assertEqual(timing.duration_ms, 5_960)

    def test_clamps_start_to_zero(self) -> None:
        timing = calculate_clip_timing(SegmentTiming(1, 400, 1_000), 10_000)
        self.assertEqual(timing.clip_start_ms, 0)

    def test_clamps_end_to_video_duration(self) -> None:
        timing = calculate_clip_timing(SegmentTiming(1, 8_000, 9_500), 10_000)
        self.assertEqual(timing.clip_end_ms, 10_000)

    def test_rejects_invalid_segment_timing(self) -> None:
        with self.assertRaisesRegex(ClipGenerationError, "invalid start_ms/end_ms"):
            calculate_clip_timing(SegmentTiming(7, 2_000, 2_000), 10_000)

    def test_uses_four_digit_clip_filename(self) -> None:
        self.assertEqual(clip_filename(42), "0042.mp4")


class ClipGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.video = self.root / "episode.mkv"
        self.video.write_bytes(b"synthetic video input")
        self.segments = self.root / "segments.json"
        self.output = self.root / "clips"
        self.manifest = self.root / "clips_manifest.json"
        self.write_segments(
            [
                {"sequence": 1, "start_ms": 2_000, "end_ms": 3_000},
                {"sequence": 2, "start_ms": 4_000, "end_ms": 5_000},
            ]
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_segments(self, segments: list[dict[str, int]]) -> None:
        self.segments.write_text(
            json.dumps({"episode": "test-s01e01", "segments": segments}),
            encoding="utf-8",
        )

    def generate(
        self,
        *,
        limit: int | None = None,
        overwrite: bool = False,
        runner: FakeMediaRunner | None = None,
    ):
        return generate_clip_files(
            episode="test-s01e01",
            video_path=self.video,
            segments_path=self.segments,
            output_directory=self.output,
            manifest_path=self.manifest,
            limit=limit,
            overwrite=overwrite,
            resolver=fake_tool_resolver,
            runner=runner or FakeMediaRunner(),
        )

    def test_missing_source_video_fails_clearly(self) -> None:
        self.video.unlink()
        with self.assertRaisesRegex(ClipGenerationError, "Source video not found"):
            self.generate()

    def test_missing_ffmpeg_fails_clearly(self) -> None:
        with self.assertRaisesRegex(ClipGenerationError, "FFmpeg executable not found"):
            require_media_tools(lambda _: None)

    def test_missing_ffprobe_fails_clearly(self) -> None:
        with self.assertRaisesRegex(ClipGenerationError, "FFprobe executable not found"):
            require_media_tools(lambda name: "ffmpeg" if name == "ffmpeg" else None)

    def test_limit_generates_first_clip_and_expected_manifest(self) -> None:
        original_segments = self.segments.read_bytes()
        runner = FakeMediaRunner()

        result = self.generate(limit=1, runner=runner)

        self.assertEqual(result.generated, 1)
        self.assertEqual(len(result.manifest["clips"]), 1)
        self.assertEqual(result.manifest["source_video"], "episode.mkv")
        self.assertEqual(
            result.manifest["padding"], {"before_ms": 1_500, "after_ms": 2_000}
        )
        entry = result.manifest["clips"][0]
        self.assertEqual(entry["file"], "clips/0001.mp4")
        self.assertEqual(entry["clip_start_ms"], 500)
        self.assertEqual(entry["clip_end_ms"], 5_000)
        self.assertEqual(entry["duration_ms"], 4_500)
        self.assertEqual(self.segments.read_bytes(), original_segments)

        ffmpeg_command = runner.commands[-1]
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-vf") + 1], "scale=-2:480")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-c:v") + 1], "libx264")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-pix_fmt") + 1], "yuv420p")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-c:a") + 1], "aac")
        self.assertEqual(ffmpeg_command[ffmpeg_command.index("-b:a") + 1], "96k")
        self.assertIn("+faststart", ffmpeg_command)
        self.assertIn("-sn", ffmpeg_command)

    def test_existing_output_is_skipped_by_default(self) -> None:
        self.output.mkdir()
        existing = self.output / "0001.mp4"
        existing.write_bytes(b"existing")
        runner = FakeMediaRunner()

        result = self.generate(limit=1, runner=runner)

        self.assertEqual(result.generated, 0)
        self.assertEqual(result.skipped, 1)
        self.assertEqual(existing.read_bytes(), b"existing")
        self.assertEqual(len(runner.commands), 1)

    def test_overwrite_regenerates_existing_output(self) -> None:
        self.output.mkdir()
        existing = self.output / "0001.mp4"
        existing.write_bytes(b"existing")

        result = self.generate(limit=1, overwrite=True)

        self.assertEqual(result.generated, 1)
        self.assertEqual(result.skipped, 0)
        self.assertEqual(existing.read_bytes(), b"synthetic mp4 bytes")

    def test_ffmpeg_failure_identifies_sequence_and_removes_partial_file(self) -> None:
        runner = FakeMediaRunner()
        runner.fail_ffmpeg = True

        with self.assertRaisesRegex(ClipGenerationFailure, "sequence 1"):
            self.generate(limit=1, runner=runner)

        self.assertFalse((self.output / "0001.mp4").exists())


class ClipVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.clips = self.root / "clips"
        self.clips.mkdir()
        self.manifest = self.root / "clips_manifest.json"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_manifest(self, *, duration_ms: int = 1_000) -> None:
        self.manifest.write_text(
            json.dumps(
                {
                    "episode": "test-s01e01",
                    "source_video": "episode.mkv",
                    "video_duration_ms": 10_000,
                    "padding": {"before_ms": 1_500, "after_ms": 2_000},
                    "clips": [
                        {
                            "sequence": 1,
                            "file": "clips/0001.mp4",
                            "clip_start_ms": 0,
                            "clip_end_ms": duration_ms,
                            "duration_ms": duration_ms,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

    def test_detects_missing_file(self) -> None:
        self.write_manifest()

        report = verify_clip_files(
            self.manifest,
            resolver=fake_tool_resolver,
            runner=FakeMediaRunner("1.000"),
        )

        self.assertFalse(report.is_valid)
        self.assertEqual(report.missing, 1)
        self.assertTrue(any("missing" in error for error in report.errors))

    def test_rejects_zero_manifest_duration(self) -> None:
        self.write_manifest(duration_ms=0)
        (self.clips / "0001.mp4").write_bytes(b"clip")

        report = verify_clip_files(
            self.manifest,
            resolver=fake_tool_resolver,
            runner=FakeMediaRunner("0.000"),
        )

        self.assertFalse(report.is_valid)
        self.assertEqual(report.invalid, 1)
        self.assertTrue(any("duration_ms" in error for error in report.errors))

    def test_accepts_duration_within_tolerance(self) -> None:
        self.write_manifest(duration_ms=1_000)
        (self.clips / "0001.mp4").write_bytes(b"clip")

        report = verify_clip_files(
            self.manifest,
            resolver=fake_tool_resolver,
            runner=FakeMediaRunner("1.200"),
        )

        self.assertTrue(report.is_valid)
        self.assertEqual(report.valid, 1)

    def test_rejects_duration_outside_tolerance(self) -> None:
        self.write_manifest(duration_ms=1_000)
        (self.clips / "0001.mp4").write_bytes(b"clip")

        report = verify_clip_files(
            self.manifest,
            resolver=fake_tool_resolver,
            runner=FakeMediaRunner("1.251"),
        )

        self.assertFalse(report.is_valid)
        self.assertTrue(any("251 ms" in error for error in report.errors))


if __name__ == "__main__":
    unittest.main()

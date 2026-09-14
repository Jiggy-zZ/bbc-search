from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CORPUS_SCRIPTS = PROJECT_ROOT / "scripts" / "corpus"
sys.path.insert(0, str(CORPUS_SCRIPTS))

from build_corpus import (  # noqa: E402
    CorpusBuildError,
    build_corpus_files,
    build_documents,
    build_segment,
)
from parse_srt import SrtParseError, SubtitleCue, parse_srt_file, parse_srt_text  # noqa: E402
from verify_corpus import verify_corpus  # noqa: E402


class ParseSrtTests(unittest.TestCase):
    def test_parses_standard_lf_srt_and_preserves_multiline_text(self) -> None:
        cues = parse_srt_text(
            "1\n00:00:02,380 --> 00:00:04,840\n第一行\nSecond line.\n"
        )

        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].sequence, 1)
        self.assertEqual(cues[0].start_ms, 2_380)
        self.assertEqual(cues[0].end_ms, 4_840)
        self.assertEqual(cues[0].lines, ("第一行", "Second line."))

    def test_reads_utf8_bom_and_crlf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.srt"
            path.write_bytes(
                "\ufeff1\r\n00:00:00,000 --> 00:00:01,250\r\nHello.\r\n".encode(
                    "utf-8"
                )
            )

            cues = parse_srt_file(path)

        self.assertEqual(cues[0].start_ms, 0)
        self.assertEqual(cues[0].end_ms, 1_250)

    def test_rejects_malformed_timestamp(self) -> None:
        with self.assertRaisesRegex(SrtParseError, "invalid timestamp range"):
            parse_srt_text("1\n00:00:xx,000 --> 00:00:01,000\nHello.\n")

    def test_rejects_end_not_after_start(self) -> None:
        with self.assertRaisesRegex(SrtParseError, "end time must be after start"):
            parse_srt_text("1\n00:00:02,000 --> 00:00:02,000\nHello.\n")

    def test_rejects_empty_cue(self) -> None:
        with self.assertRaisesRegex(SrtParseError, "expected sequence, timestamp, and text"):
            parse_srt_text("1\n00:00:00,000 --> 00:00:01,000\n")


class BuildCorpusTests(unittest.TestCase):
    def make_cue(self, *lines: str) -> SubtitleCue:
        return SubtitleCue(sequence=1, start_ms=100, end_ms=900, lines=lines)

    def test_builds_bilingual_segment_and_cleans_control_tags(self) -> None:
        segment = build_segment(
            self.make_cue("{\\fs16\\an2}测试字幕", "It’s   ORIGINAL.")
        )

        self.assertEqual(segment.text_zh, "测试字幕")
        self.assertEqual(segment.text_en, "It’s ORIGINAL.")
        self.assertEqual(segment.normalized_zh, "测试字幕")
        self.assertEqual(segment.normalized_en, "it's original.")
        self.assertIsNone(segment.speaker)
        self.assertIsNone(segment.alignment_confidence)

    def test_merges_multiple_lines_of_each_language(self) -> None:
        segment = build_segment(
            self.make_cue("这是第一行", "这是第二行", "English line one", "line two.")
        )

        self.assertEqual(segment.text_zh, "这是第一行 这是第二行")
        self.assertEqual(segment.text_en, "English line one line two.")

    def test_allows_english_only(self) -> None:
        segment = build_segment(self.make_cue("Bazinga!"))

        self.assertIsNone(segment.text_zh)
        self.assertEqual(segment.normalized_en, "bazinga!")

    def test_allows_chinese_only(self) -> None:
        segment = build_segment(self.make_cue("只有中文。"))

        self.assertEqual(segment.text_zh, "只有中文。")
        self.assertIsNone(segment.text_en)

    def test_rejects_cue_containing_only_control_tags(self) -> None:
        with self.assertRaisesRegex(CorpusBuildError, "no text after"):
            build_segment(self.make_cue("{\\fs16\\an2}"))

    def test_writes_deterministic_corpus_and_text_free_manifest(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "synthetic_bilingual.srt"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "generated" / "segments.json"
            manifest_path = Path(directory) / "manifests" / "episode.json"

            corpus, manifest = build_corpus_files(
                "test-s01e01", fixture, output, manifest_path
            )
            first_output = output.read_bytes()
            build_corpus_files("test-s01e01", fixture, output, manifest_path)

            self.assertEqual(output.read_bytes(), first_output)
            self.assertEqual(len(corpus["segments"]), 3)
            self.assertEqual(manifest["bilingual"], 2)
            self.assertEqual(manifest["english_only"], 1)
            self.assertNotIn("text_en", json.dumps(manifest))
            self.assertNotIn(str(fixture.resolve()), json.dumps(manifest))


class VerifyCorpusTests(unittest.TestCase):
    def test_accepts_valid_generated_document(self) -> None:
        cues = [
            SubtitleCue(1, 0, 1_000, ("你好。", "Hello.")),
            SubtitleCue(2, 1_000, 2_000, ("English only.",)),
        ]
        corpus, _ = build_documents("test-s01e01", cues)

        report = verify_corpus(corpus)

        self.assertTrue(report.is_valid)
        self.assertEqual(report.segments, 2)
        self.assertEqual(report.bilingual, 1)
        self.assertEqual(report.english_only, 1)

    def test_detects_duplicate_sequence_and_contract_violations(self) -> None:
        invalid_segment = {
            "sequence": 1,
            "start_ms": 100,
            "end_ms": 100,
            "speaker": "Someone",
            "text_zh": None,
            "text_en": "Hello",
            "normalized_zh": None,
            "normalized_en": None,
            "alignment_confidence": 1.0,
        }
        document = {
            "episode": "test-s01e01",
            "segments": [
                {
                    **invalid_segment,
                    "end_ms": 200,
                    "speaker": None,
                    "normalized_en": "hello",
                    "alignment_confidence": None,
                },
                invalid_segment,
            ],
        }

        report = verify_corpus(document)

        self.assertFalse(report.is_valid)
        self.assertEqual(report.invalid, 1)
        self.assertTrue(any("duplicated" in error for error in report.errors))
        self.assertTrue(any("speaker must be null" in error for error in report.errors))
        self.assertTrue(any("alignment_confidence" in error for error in report.errors))


if __name__ == "__main__":
    unittest.main()

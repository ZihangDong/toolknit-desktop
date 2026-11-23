"""Ensure fidelity QA cannot accept equal line counts with different wrapping."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("fidelity", Path(__file__).with_name("test-word-to-pdf-fidelity.py"))
fidelity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fidelity)


class LineBaselineTests(unittest.TestCase):
    def test_equal_line_counts_with_different_breaks_fail(self):
        expected = ["中文与 English 混排的第一行", "第二行到这里结束。"]
        actual = ["页眉", "中文与 English 混排的第一行第二", "行到这里结束。"]
        with self.assertRaisesRegex(AssertionError, "paragraph line 1: line break/text differs"):
            fidelity.compare_expected_lines(actual, expected, 7)

    def test_all_lines_are_checked_and_whitespace_is_ignored(self):
        expected = ["这是较长中文段落的第一行，包含明确的定位文字。", "第二行固定停在这里", "第三行结束。"]
        actual = ["页眉", expected[0], "第 二 行 固 定 停 在 这 里", "第三行结束。", "页脚"]
        self.assertEqual(fidelity.compare_expected_lines(actual, expected, 7), 1)
        actual[3] = "第三行结束"
        with self.assertRaisesRegex(AssertionError, "paragraph line 3"):
            fidelity.compare_expected_lines(actual, expected, 7)

    def test_missing_or_truncated_paragraph_fails_explicitly(self):
        expected = ["这是较长中文段落的第一行，包含明确的定位文字。", "末行。"]
        with self.assertRaisesRegex(AssertionError, "paragraph start was not found"):
            fidelity.compare_expected_lines(["其他正文"], expected, 7)
        with self.assertRaisesRegex(AssertionError, "paragraph line 2"):
            fidelity.compare_expected_lines([expected[0]], expected, 7)

    def test_reference_pdf_requires_each_line_and_bounds_to_match(self):
        line = {"text": "中文正文", "x0": 70, "top": 100, "x1": 118, "bottom": 112}
        fidelity.compare_line_geometry([line], [dict(line, top=100.2)], 7)
        with self.assertRaisesRegex(AssertionError, "line text/break differs"):
            fidelity.compare_line_geometry([line], [dict(line, text="中文正文下一行")], 7)
        with self.assertRaisesRegex(AssertionError, "text bounds differ"):
            fidelity.compare_line_geometry([line], [dict(line, x1=120)], 7)
        with self.assertRaisesRegex(AssertionError, "visual line count differs"):
            fidelity.compare_line_geometry([line], [line, line], 7)


if __name__ == "__main__":
    unittest.main()

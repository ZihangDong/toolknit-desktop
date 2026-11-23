"""Exercise generic CJK line fitting and complete punctuation retention.

Run with QA Python (pdfplumber), passing the engine's UNO Python separately.
The first-line baselines were checked in the source viewer with actual SimSun.
No reference data is passed to the conversion driver.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

import pdfplumber
from runtime_info import runtime_info

ROOT = Path(__file__).resolve().parent
DRIVER = ROOT.parent / "src-tauri/resources/office/word-to-pdf.py"
EXPECTED_LENGTHS = (20, 20, 20, 20, 21, 21, 20, 21, 21)
WIDTHS_EM = (20.25, 20.5, 20.75) * 3
WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def font_binding_fixture(template, output, split):
    """No personal content; default/eastAsia font selection checked in viewer.

    This fixture checks font binding, not approval of Writer's quote wrapping.
    The source viewer still fits this text in fewer lines than Writer.
    """
    with zipfile.ZipFile(template) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    root = ET.fromstring(parts["word/document.xml"])
    body = root.find(WORD + "body")
    section = body.find(WORD + "sectPr")
    body.clear()
    section.find(WORD + "pgMar").set(WORD + "right", "5666")
    section.find(WORD + "docGrid").attrib = {WORD + "type": "default"}
    for hint in (None, "default", "eastAsia"):
        for heading, text in ((True, "hint " + str(hint)), (False, "甲“乙”" * 14)):
            p = ET.SubElement(body, WORD + "p")
            props = ET.SubElement(p, WORD + "pPr")
            ET.SubElement(props, WORD + "jc", {WORD + "val": "left"})
            for flag in ("autoSpaceDE", "autoSpaceDN"):
                ET.SubElement(props, WORD + flag, {WORD + "val": "0"})
            ET.SubElement(props, WORD + "spacing", {WORD + "before": "120" if heading else "0",
                          WORD + "after": "0", WORD + "line": "300", WORD + "lineRule": "exact"})
            for segment in ([text] if heading or not split else [text[i:i + 4] for i in range(0, len(text), 4)]):
                run = ET.SubElement(p, WORD + "r")
                rpr = ET.SubElement(run, WORD + "rPr")
                fonts = {WORD + "ascii": "Times New Roman", WORD + "hAnsi": "Times New Roman", WORD + "eastAsia": "SimSun"}
                if hint:
                    fonts[WORD + "hint"] = hint
                ET.SubElement(rpr, WORD + "rFonts", fonts)
                ET.SubElement(rpr, WORD + "sz", {WORD + "val": "18" if heading else "24"})
                ET.SubElement(rpr, WORD + "lang", {WORD + "val": "en-US", WORD + "eastAsia": "zh-CN"})
                ET.SubElement(run, WORD + "t").text = segment
    body.append(section)
    parts["word/document.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    parts["word/settings.xml"] = parts["word/settings.xml"].replace(b"compressPunctuation", b"doNotCompress")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return output


def characters(value):
    return Counter(char for char in value if not char.isspace())


def verify(source, output):
    with zipfile.ZipFile(source) as archive:
        xml = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = ["".join(node.text or "" for node in p.iter(WORD + "t"))
                  for p in xml.find(WORD + "body").findall(WORD + "p")]
    source_text = "".join(node.text or "" for node in xml.iter(WORD + "t"))
    with pdfplumber.open(output) as document:
        if source.name == "word-page-break-spacing.docx":
            assert len(document.pages) == 4, "Page-start spacing changed pagination"
            actual_text = "".join(char["text"] for page in document.pages for char in page.chars)
            assert characters(actual_text) == characters(source_text), "Page-start fixture lost characters"
            lines = [page.extract_text_lines() for page in document.pages]
            assert [len(page) for page in lines] == [1, 1, 6, 1]
            assert [page[0]["text"] for page in lines] == [
                "Marker first", "Marker explicit", "Marker zero", "Marker natural"]
            origin = lines[0][0]["top"]
            offsets = [page[0]["top"] - origin for page in lines]
            assert all(abs(a - b) < .05 for a, b in zip(offsets, (0, 20, 0, 0))), (
                "Explicit before spacing must survive; automatic pagination must collapse it")
            return {"completeCharacterRetention": True, "pages": 4,
                    "pageStartOffsetsPt": offsets}, lines
        assert len(document.pages) == 1, "Generic fixture pagination changed"
        page = document.pages[0]
        actual_text = "".join(char["text"] for char in page.chars)
        assert characters(actual_text) == characters(source_text), "Characters, including punctuation, were lost or duplicated"
        lines = page.extract_text_lines()
        result = {"completeCharacterRetention": True, "pages": 1}
        if source.name == "word-script-space-line-end.docx":
            assert len(lines) == 9, "Trailing script spacing changed the approved wraps"
            starts = [lines[i] for i in (0, 3, 6)]
            assert [line["text"].replace(" ", "") for line in starts] == [
                paragraphs[0][:8], paragraphs[1][:8], paragraphs[2][:8]]
            ends = [line["chars"][-1]["x1"] for line in starts]
            advances = [end - line["x0"] for end, line in zip(ends, starts)]
            assert all(abs(a - b) < .1 for a, b in zip(advances, (87, 77, 90))), "Automatic script gap was redistributed over justified text"
            assert all(abs(char["size"] - 12) < .01 for line in lines for char in line["chars"])
            result["lineEndGlyphRightPt"] = ends
        if source.name == "word-closing-hanging-priority.docx":
            assert len(lines) == 6, "Closing punctuation changed the paragraph line count"
            assert [line["text"].replace(" ", "") for line in lines] == [
                paragraphs[0][:38], paragraphs[0][38:], paragraphs[1][:40],
                paragraphs[1][40:], paragraphs[2][:38], paragraphs[2][38:]], "Closing priority changed the approved wraps"
            origins = [lines[i]["chars"][-1]["x0"] for i in (0, 2)]
            assert all(abs(a - b) < .15 for a, b in zip(origins, (534, 531))), "Closing mark compressed the prefix or exceeded half-em hanging"
            assert all(abs(char["size"] - 12) < .01 for line in lines for char in line["chars"])
            for line in (lines[0], lines[2]):
                # These lines need no internal punctuation compression. Every
                # CJK glyph retains its natural twelve-point advance.
                chars = line["chars"]
                for left, right in zip(chars, chars[1:]):
                    if len(left["text"]) == 1 and ord(left["text"]) > 0x2e80:
                        assert abs(right["x0"] - left["x0"] - 12) < .15, "Internal punctuation was compressed before hanging"
            result["closingPunctuationOriginsPt"] = origins
        if source.name == "word-body-hanging-inner.docx":
            assert lines[0]["text"].endswith("准备学生、"), "Hanging punctuation changed the approved wrap"
            last = lines[0]["chars"][-1]
            assert last["text"] == "、" and abs(last["size"] - 12) < .01
            assert abs(last["x0"] - (72 + 468 - 6)) < .2, "Hanging punctuation lost its inner half em"
            assert len(lines) == 15, "Hanging punctuation fixture pagination/wrapping changed"
            result["closingPunctuationInnerWidthPt"] = 6
        if source.name.startswith("word-space-context"):
            assert [line["text"].replace(" ", "") for line in lines] == ["ABCDEF", "[1]Alpha", "甲ABC", "ABCDEF"]
            positions = [next(c["x0"] for c in line["chars"] if c["text"] == target)
                         for line, target in zip(lines, ("D", "A", "A", "D"))]
            expected = (99.75, 88.4, 90.1, 102.75 if "disabled" in source.name else 108.75)
            assert all(abs(a - b) < .15 for a, b in zip(positions, expected)), "Space width depends on a formatting boundary"
            result["spaceContextGlyphOriginsPt"] = positions
        if source.name.startswith("word-latin-space-balance"):
            approved = (
                "[1] Alpha beta gamma delta epsilon",
                "[1] Alpha beta gamma delta epsilon zeta",
                "[1] Alpha beta gamma delta epsilon zeta eta",
            )
            starts = [i + 1 for i, line in enumerate(lines) if line["text"].startswith("width ")]
            assert [lines[i]["text"] for i in starts] == list(approved), "Latin word-space measurement changed line fitting"
            assert len(lines) == 33, "Latin field text changed wrapping"
            assert all(char["fontname"].split("+")[-1] == "TimesNewRomanPSMT"
                       and abs(char["size"] - (9 if line["text"].startswith("width ") else 12)) < .01
                       for line in lines for char in line["chars"]), "Latin spacing changed font metrics"
            result["latinFieldFirstLines"] = list(approved)
        if source.name == "word-opening-quote-line-fit.docx":
            checked = []
            for index, length in enumerate((19, 22, 22)):
                header, text = paragraphs[index * 2:index * 2 + 2]
                start = next(i for i, line in enumerate(lines) if line["text"] == header)
                line = lines[start + 1]
                assert line["text"] == text[:length], f"{header}: opening quote pair moved to next line"
                width = int(header.split()[-1]) / 20
                assert line["x1"] <= line["x0"] + width + .2, "Quote pair exceeds paragraph width"
                assert all(abs(char["size"] - 10.5) < .01 for char in line["chars"]), "Quote fitting resized glyphs"
                checked.append({"widthTwips": int(header.split()[-1]), "firstLine": line["text"], "passed": True})
            result["openingQuotePairCases"] = checked
        if source.name.startswith("word-fractional-script-spacing"):
            checked = []
            for index in range(8):
                header, text = paragraphs[index * 2:index * 2 + 2]
                start = next(i for i, line in enumerate(lines) if line["text"] == header)
                line = lines[start + 1]
                chars = line["chars"]
                expected = 20
                assert line["text"].replace(" ", "") == text[:expected], f"{header}: fractional gaps changed line fitting"
                gaps = [b["x0"] - a["x1"] for a, b in zip(chars, chars[1:])]
                assert all(abs(gap - 2.625) < .08 for gap in gaps), "Quarter-em gap changed"
                # PDF font tables use fractional advances (e.g. 2.9085 pt for
                # i) while Writer positions each glyph at integer twips. Read
                # script gaps from consecutive origins and the twip-quantized
                # advance, so PDF table rounding is not counted as layout drift.
                native_gaps = [b["x0"] - a["x0"] - round((a["x1"] - a["x0"]) * 20) / 20
                               for a, b in zip(chars, chars[1:])]
                error = sum(native_gaps) - len(native_gaps) * 2.625
                assert abs(error) < .051, "Fractional gaps accumulate rounding error"
                assert all(abs(char["size"] - 10.5) < .01 for char in chars), "Fractional spacing resized glyphs"
                checked.append({"widthTwips": int(header.split()[-1]), "firstLineLength": expected,
                                "cumulativeGapErrorPt": error, "passed": True})
            result["fractionalScriptSpacingCases"] = checked
        if source.name.startswith("word-table-closing-bracket"):
            enabled = "disabled" not in source.name
            expected = ["甲乙（丙丁）", "戊己"] * 2
            assert [line["text"] for line in lines] == expected, "Table bracket line break changed"
            for line in lines:
                assert all(char["fontname"].split("+")[-1] == "SimSun" and abs(char["size"] - 10.5) < .01
                           for char in line["chars"]), "Table bracket font changed"
            for index in (0, 2):
                advances = [b["x0"] - a["x0"] for a, b in zip(lines[index]["chars"], lines[index]["chars"][1:])]
                if enabled:
                    assert all(abs(advance - 10.5) < .12 for advance in advances), "Hanging bracket compressed glyph advances"
                    assert abs(lines[index]["x0"] - 77.5) < .2, "Centered hanging label shifted right"
                else:
                    assert any(advance < 10 for advance in advances), "Disabled hanging unexpectedly used the bracket hanging path"
                assert abs(lines[index + 1]["top"] - lines[index]["top"] - 15.6) < .1
            # Equal row heights place equal auto/exact labels on the same
            # baseline relative to their row, without a fixed-only exception.
            assert abs(lines[2]["top"] - lines[0]["top"] - 45) < .1
            result["bracketHangingEnabled"] = enabled
            result["autoAndExactGridBaselineEquivalent"] = True
        if source.name.startswith("word-font-binding"):
            checked = []
            for index, hint in enumerate((None, "default", "eastAsia")):
                start = next(i for i, line in enumerate(lines) if line["text"] == "hint " + str(hint))
                end = next((i for i in range(start + 1, len(lines)) if lines[i]["text"].startswith("hint ")), len(lines))
                text_lines = lines[start + 1:end]
                chars = [char for line in text_lines for char in line["chars"]]
                assert "".join(char["text"] for char in chars) == "甲“乙”" * 14
                for char in chars:
                    expected = "TimesNewRomanPSMT" if char["text"] in "“”" and hint != "eastAsia" else "SimSun"
                    assert char["fontname"].split("+")[-1] == expected, f"{hint}: font binding changed for {char['text']}"
                    assert abs(char["size"] - 12) < .01, "Font binding changed the font size"
                checked.append({"hint": hint, "fontsCorrect": True,
                                "layoutLines": [line["text"] for line in text_lines]})
            result["fontBindingCases"] = checked
            result["fontBindingOnlyNotLineFidelityApproval"] = True
        if source.name == "word-auto-spacing.docx":
            cases = []
            for index, (length, enabled) in enumerate(zip((30, 22, 26, 20, 22), (False, True, False, True, True))):
                header, text = paragraphs[index * 2:index * 2 + 2]
                start = next(i for i, line in enumerate(lines) if line["text"] == header)
                line = lines[start + 1]
                actual = "".join(char["text"] for char in line["chars"])
                assert actual == text[:length], f"{header}: script spacing changed line fitting"
                first, second = line["chars"][:2]
                gap = second["x0"] - first["x1"]
                assert abs(gap - (3 if enabled else 0)) < .12, f"{header}: inter-script distance {gap:.3f}pt"
                assert all(abs(char["size"] - 12) < .01 for char in line["chars"]), "Font size changed"
                cases.append({"label": header, "firstLine": actual, "interScriptGapPt": gap, "passed": True})
            result["spacingCases"] = cases
        if source.name.startswith("word-chinese-compression"):
            checked = []
            for index, (count, width) in enumerate(zip(EXPECTED_LENGTHS, WIDTHS_EM)):
                header, text = paragraphs[index * 2:index * 2 + 2]
                start = next(i for i, line in enumerate(lines) if line["text"] == header)
                line = lines[start + 1]
                assert line["text"] == text[:count], f"{header}: first line differs: {line['text']}"
                assert abs(line["x0"] - 72) < .2, "Text origin changed"
                assert line["x1"] <= 72 + width * 12 + .2, "Text exceeds the actual paragraph boundary"
                assert all(char["fontname"].split("+")[-1] == "SimSun" and abs(char["size"] - 12) < .01
                           for char in line["chars"]), "The baseline font was replaced or scaled"
                checked.append({"label": header, "firstLine": line["text"], "passed": True})
            result["lineFitCases"] = checked
        return result, lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--soffice", type=Path, required=True)
    parser.add_argument("--office-python", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    results = []
    layouts = []
    table_layouts = {}
    data = args.source_root.resolve() / "sw/qa/extras/ooxmlimport/data"
    sources = [data / name for name in (
        "word-chinese-compression.docx", "word-chinese-compression-split.docx", "hanging-punctuation.docx", "word-auto-spacing.docx",
        "table-ignored-grid-snap.docx", "table-ignored-grid-no-snap.docx", "table-exact-grid-snap.docx", "table-exact-grid-no-snap.docx",
        "word-table-closing-bracket.docx", "word-table-closing-bracket-disabled.docx",
        "word-fractional-script-spacing.docx", "word-fractional-script-spacing-split.docx", "word-opening-quote-line-fit.docx",
        "word-page-break-spacing.docx", "word-latin-space-balance.docx", "word-latin-space-balance-disabled.docx",
        "word-body-hanging-inner.docx", "word-space-context.docx", "word-space-context-disabled.docx",
        "word-closing-hanging-priority.docx", "word-script-space-line-end.docx")]
    sources.extend(font_binding_fixture(data / "word-auto-spacing.docx", output / name, split)
                   for name, split in (("word-font-binding.docx", False), ("word-font-binding-split.docx", True)))
    binding_layouts = []
    fractional_layouts = []
    latin_space_layouts = []
    for source in sources:
        name = source.name
        row = {"fixture": name}
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        pdf = output / (source.stem + ".pdf")
        try:
            with tempfile.TemporaryDirectory(prefix="toolknit-cjk-profile-") as profile:
                process = subprocess.run([str(args.office_python), str(DRIVER), str(args.soffice),
                                          str(source), str(pdf), profile], capture_output=True, timeout=120,
                                         creationflags=0x08000000 if os.name == "nt" else 0)
                assert process.returncode == 0, process.stdout.decode("utf-8", errors="replace")
                assert json.loads(process.stdout)["ok"], "Application converter reported failure"
            row.update(verify(source, pdf)[0])
            if name.startswith("word-chinese-compression"):
                with pdfplumber.open(pdf) as document:
                    layouts.append(document.pages[0].extract_text_lines())
            if name.startswith("table-"):
                with pdfplumber.open(pdf) as document:
                    table_layouts[name] = document.pages[0].extract_text_lines()
            if name.startswith("word-font-binding"):
                with pdfplumber.open(pdf) as document:
                    binding_layouts.append(document.pages[0].extract_text_lines())
            if name.startswith("word-fractional-script-spacing"):
                with pdfplumber.open(pdf) as document:
                    fractional_layouts.append(document.pages[0].extract_text_lines())
            if name.startswith("word-latin-space-balance"):
                with pdfplumber.open(pdf) as document:
                    latin_space_layouts.append(document.pages[0].extract_text_lines())
            assert hashlib.sha256(source.read_bytes()).hexdigest() == digest, "Source fixture was modified"
            row.update(passed=True, sourceUnchanged=True)
        except (AssertionError, StopIteration, subprocess.SubprocessError) as error:
            row.update(passed=False, error=str(error))
        results.append(row)
    split_invariant = False
    split_bounds_delta = None
    if len(layouts) == 2:
        split_bounds_delta = max(max(abs(a[key] - b[key]) for key in ("x0", "x1", "top", "bottom"))
                                 for a, b in zip(*layouts))
        split_invariant = len(layouts[0]) == len(layouts[1]) and split_bounds_delta < 1 and all(
            a["text"] == b["text"] for a, b in zip(*layouts))
    table_checks = []
    for prefix in ("table-ignored-grid-", "table-exact-grid-"):
        first = table_layouts.get(prefix + "snap.docx", [])
        second = table_layouts.get(prefix + "no-snap.docx", [])
        indexes = range(len(first)) if "ignored" in prefix else (0, 2, 3)
        matched = bool(first) and len(first) == len(second) and all(
            index < len(first) and first[index]["text"] == second[index]["text"]
            and max(abs(first[index][key] - second[index][key]) for key in ("x0", "x1", "top", "bottom")) < .1
            for index in indexes)
        table_checks.append({"case": prefix.rstrip("-"), "passed": matched,
                             "comparison": "all lines" if "ignored" in prefix else "fixed-spacing lines"})
    binding_invariant = len(binding_layouts) == 2 and len(binding_layouts[0]) == len(binding_layouts[1]) and all(
        a["text"] == b["text"] and max(abs(a[key] - b[key]) for key in ("x0", "x1", "top", "bottom")) < 1
        for a, b in zip(*binding_layouts))
    fractional_invariant = len(fractional_layouts) == 2 and len(fractional_layouts[0]) == len(fractional_layouts[1]) and all(
        a["text"] == b["text"] and max(abs(a[key] - b[key]) for key in ("x0", "x1", "top", "bottom")) < .1
        for a, b in zip(*fractional_layouts))
    latin_space_invariant = len(latin_space_layouts) == 2 and len(latin_space_layouts[0]) == len(latin_space_layouts[1]) and all(
        a["text"] == b["text"] and len(a["chars"]) == len(b["chars"]) and all(
            max(abs(c[key] - d[key]) for key in ("x0", "x1", "top", "bottom")) < .1
            for c, d in zip(a["chars"], b["chars"])) for a, b in zip(*latin_space_layouts))
    report = {"passed": all(row["passed"] for row in results) and split_invariant and binding_invariant and fractional_invariant and latin_space_invariant and all(row["passed"] for row in table_checks),
              "engine": runtime_info(args.soffice), "cases": results,
              "formattingRunSplitPreservesTextAndBounds": split_invariant,
              "formattingRunSplitMaxBoundsDeltaPt": split_bounds_delta,
              "boundsTolerancePt": 1,
              "tableGridChecks": table_checks,
              "fontBindingRunSplitPreservesTextAndBounds": binding_invariant,
              "fractionalSpacingRunSplitPreservesTextAndBounds": fractional_invariant,
              "latinSpaceBalancePreservesWordBreaksAndGlyphOrigins": latin_space_invariant,
              "visualFidelityApproved": False,
              "comparisonScope": "generic CJK regression fixtures; not whole-document fidelity approval"}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

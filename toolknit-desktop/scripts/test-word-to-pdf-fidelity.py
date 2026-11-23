"""Validate LibreOffice pagination against an already approved reference PDF.

Run with --source sample.docx --reference reference.pdf --soffice soffice.com.
The test only reads the reference; it never launches Word or WPS. QA requires
pdfplumber. --office-python defaults to the UNO Python next to soffice.
Personal documents and generated PDFs are not committed as fixtures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import Counter
import zipfile
import xml.etree.ElementTree as ET

import pdfplumber

DRIVER = Path(__file__).resolve().parents[1] / "src-tauri/resources/office/word-to-pdf.py"
FLAGS = 0x08000000 if os.name == "nt" else 0


def normalized(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text or ""))


def compare_expected_lines(lines, expected, page):
    """Require the approved text on every line, including its break position."""
    assert expected and all(isinstance(line, str) and normalized(line) for line in expected), "Empty line baseline"
    prefix = normalized(expected[0])[:20]
    start = next((i for i, line in enumerate(lines) if normalized(line).startswith(prefix)), None)
    assert start is not None, f"Page {page}: approved paragraph start was not found"
    for offset, approved in enumerate(expected):
        actual = lines[start + offset] if start + offset < len(lines) else ""
        assert normalized(actual) == normalized(approved), (
            f"Page {page}, paragraph line {offset + 1}: line break/text differs\n"
            f"expected: {approved}\nactual:   {actual}")
    return start


def compare_line_geometry(actual, expected, page, tolerance=1):
    """Equal page text is insufficient: wrapping and every origin must agree."""
    assert len(actual) == len(expected), f"Page {page}: visual line count differs"
    for index, (line, baseline) in enumerate(zip(actual, expected), 1):
        assert normalized(line["text"]) == normalized(baseline["text"]), f"Page {page}, line {index}: line text/break differs"
        delta = max(abs(line[key] - baseline[key]) for key in ("x0", "top", "x1", "bottom"))
        assert delta < tolerance, f"Page {page}, line {index}: text bounds differ by {delta:.2f}pt"


def table_text(table):
    return [[normalized(cell) for cell in row] for row in table.extract()]


def body_anchor(page, table_bottom):
    lines = [line for line in page.extract_text_lines() if line["top"] > table_bottom]
    while len(lines) > 1 and re.match(r"^\d+[.、]", normalized(lines[0]["text"])):
        lines.pop(0)
    return lines[0] if lines else None


def compare_pdf(actual, reference):
    max_anchor_delta = max_table_delta = 0
    with pdfplumber.open(actual) as output, pdfplumber.open(reference) as expected:
        assert output.metadata.get("Producer", "").startswith("LibreOffice"), "Conversion must use LibreOffice"
        assert len(output.pages) == len(expected.pages), "Natural pagination changed"
        for number, (page, baseline) in enumerate(zip(output.pages, expected.pages), 1):
            assert abs(page.width - baseline.width) < 0.2 and abs(page.height - baseline.height) < 0.2
            tables, baseline_tables = page.find_tables(), baseline.find_tables()
            assert len(tables) == len(baseline_tables), f"Page {number} table structure changed"
            bottom = baseline_bottom = 0
            for table, original in zip(tables, baseline_tables):
                assert table_text(table) == table_text(original), f"Page {number} table cells lost text"
                delta = max(abs(a - b) for a, b in zip(table.bbox, original.bbox))
                max_table_delta = max(max_table_delta, delta)
                assert delta < 1, f"Page {number} table geometry changed"
                assert len(table.rows) == len(original.rows), f"Page {number} table row count changed"
                for row, original_row in zip(table.rows, original.rows):
                    assert len(row.cells) == len(original_row.cells), f"Page {number} table column count changed"
                    for cell, original_cell in zip(row.cells, original_row.cells):
                        assert (cell is None) == (original_cell is None), f"Page {number} merged cells changed"
                        if cell is not None:
                            compare_line_geometry(page.crop(cell).extract_text_lines(),
                                                  baseline.crop(original_cell).extract_text_lines(), number)
                bottom, baseline_bottom = max(bottom, table.bbox[3]), max(baseline_bottom, original.bbox[3])
                # Compare cells separately: wrapping can otherwise interleave a
                # label with the text in the neighbouring cell during extraction.
                page, baseline = page.outside_bbox(table.bbox), baseline.outside_bbox(original.bbox)
            assert normalized(page.extract_text()) == normalized(baseline.extract_text()), f"Page {number} text moved to another page"
            compare_line_geometry(page.extract_text_lines(), baseline.extract_text_lines(), number)
            anchor, original = body_anchor(page, bottom), body_anchor(baseline, baseline_bottom)
            if anchor is not None and original is not None:
                assert normalized(anchor["text"])[:12] == normalized(original["text"])[:12]
                delta = max(abs(anchor[key] - original[key]) for key in ("x0", "top"))
                max_anchor_delta = max(max_anchor_delta, delta)
                assert delta < 1, f"Page {number} body origin changed by {delta:.2f}pt"
            fonts = {(c["fontname"].split("+")[-1], round(c["size"], 2)) for c in page.chars}
            for char in baseline.chars:
                face, size = char["fontname"].split("+")[-1], char["size"]
                assert any(name == face and abs(points - size) < 0.1 for name, points in fonts), f"Page {number} font or size changed"
        return {"pages": len(output.pages), "maxBodyAnchorDeltaPt": round(max_anchor_delta, 3),
                "maxTableEdgeDeltaPt": round(max_table_delta, 3)}


def compare_source(actual, source, first_page_end, pages=None):
    with zipfile.ZipFile(source) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    source_text = normalized("".join(node.text or "" for node in document.iter(ns + "t")))
    with pdfplumber.open(actual) as output:
        assert output.metadata.get("Producer", "").startswith("LibreOffice"), "Conversion must use LibreOffice"
        if pages is not None:
            assert len(output.pages) == pages, "Natural pagination changed"
        text = normalized("".join(char["text"] for page in output.pages for char in page.chars))
        assert Counter(text) == Counter(source_text), "Source characters were lost or duplicated"
        last_line = output.pages[0].extract_text_lines()[-1]["text"]
        assert normalized(last_line).endswith(normalized(first_page_end)), "First page does not end at the approved text"
        return {"pages": len(output.pages), "sourceCharacters": len(source_text), "firstPageLastLine": last_line}


def compare_page_checks(actual, source, checks_path, pages=None):
    """Validate screenshot-approved page/paragraph checkpoints in long docs.

    Checkpoints are external QA data, never converter input or layout hints.
    They allow targeted regression checks without treating an old, inaccurate
    PDF as the authoritative pagination for every page of a long document.
    """
    checks = json.loads(checks_path.read_text(encoding="utf-8-sig"))
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(source) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    source_text = normalized("".join(node.text or "" for node in root.iter(ns + "t")))
    # Repeated running/table headers and footnotes legitimately add characters.
    # Test source letters/numbers independently of repeated headers, leader dots,
    # punctuation hanging at the page edge and generated page-number fields.
    letters = lambda text: Counter(c for c in text if unicodedata.category(c)[0] in "LN")
    results = []
    with pdfplumber.open(actual) as output:
        assert output.metadata.get("Producer", "").startswith("LibreOffice")
        assert len(output.pages) == (pages or checks["pages"]), "Natural pagination changed"
        actual_text = normalized("".join(c["text"] for page in output.pages for c in page.chars))
        assert not (letters(source_text) - letters(actual_text)), "Source letters/numbers were lost"
        for check in checks["checks"]:
            page = output.pages[check["page"] - 1]
            if "crop" in check:
                page = page.crop(tuple(check["crop"]))
            lines = [line["text"] for line in page.extract_text_lines()]
            text = normalized("".join(lines))
            if "lastLineEndsWith" in check:
                tail = re.sub(r"\.{3,}|…+", "", lines[-1])
                assert normalized(tail).endswith(normalized(check["lastLineEndsWith"])), f"Page {check['page']} ending changed"
            if "contains" in check:
                assert normalized(check["contains"]) in text, f"Page {check['page']} lost its checkpoint"
            if "excludes" in check:
                assert normalized(check["excludes"]) not in text, f"Page {check['page']} gained text from the next page"
            if "paragraph" in check:
                target = check["paragraph"]
                if "expectedLines" in target:
                    compare_expected_lines(lines, target["expectedLines"], check["page"])
                else:
                    start = next((i for i, line in enumerate(lines) if normalized(line).startswith(normalized(target["startsWith"]))), None)
                    assert start is not None, f"Page {check['page']} paragraph start was not found"
                    end = next((i for i in range(start, len(lines)) if normalized(lines[i]).endswith(normalized(target["endsWith"]))), None)
                    assert end is not None, f"Page {check['page']} paragraph end was not found"
                    assert end - start + 1 == target["lines"], f"Page {check['page']} paragraph line count changed"
            results.append({"page": check["page"], "passed": True})
        assert sum(len(page.images) for page in output.pages) == checks["images"], "Image count changed"
        return {"pages": len(output.pages), "images": checks["images"], "sourceLettersAndNumbersRetained": True,
                "pageChecks": results, "comparisonScope": "approved checkpoints, not full-page visual equality"}


def run_driver(python, args):
    env = {**os.environ, "SAL_USE_VCLPLUGIN": "svp", "SAL_DISABLE_PRINTERLIST": "1"}
    result = subprocess.run([str(python), str(DRIVER), *map(str, args)],
                            capture_output=True, timeout=180, env=env, creationflags=FLAGS)
    assert result.returncode == 0, result.stdout.decode("utf-8", errors="replace")
    status = json.loads(result.stdout)
    assert status["ok"], status
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    expected = parser.add_mutually_exclusive_group(required=True)
    expected.add_argument("--reference", type=Path)
    expected.add_argument("--first-page-end", help="Approved source text at the end of page one")
    expected.add_argument("--page-checks", type=Path, help="JSON checkpoints approved by comparing source screenshots")
    parser.add_argument("--pages", type=int)
    parser.add_argument("--soffice", type=Path, required=True)
    parser.add_argument("--office-python", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    python = args.office_python or args.soffice.parent / ("python.exe" if os.name == "nt" else "python3")
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    def compare(actual):
        if args.reference:
            return compare_pdf(actual, args.reference)
        if args.page_checks:
            return compare_page_checks(actual, args.source, args.page_checks, args.pages)
        return compare_source(actual, args.source, args.first_page_end, args.pages)
    with tempfile.TemporaryDirectory(prefix="tk-word-fidelity-") as temporary:
        work = Path(temporary)
        source = work / ("sample" + args.source.suffix)
        shutil.copyfile(args.source, source)
        single = work / "single.pdf"
        run_driver(python, [args.soffice, source, single, work / "single-profile"])
        comparison = compare(single)
        invalid = work / "invalid.docx"
        invalid.write_bytes(b"not a document")
        batch = work / "batch.pdf"
        manifest = work / "batch.json"
        manifest.write_text(json.dumps({"items": [
            {"index": 0, "source": str(source), "destination": str(batch)},
            {"index": 1, "source": str(invalid), "destination": str(work / "invalid.pdf")},
        ]}), encoding="utf-8")
        status_path = work / "batch-status.json"
        result = run_driver(python, [args.soffice, "--manifest", manifest, work / "batch-profile", status_path])
        assert [row["status"] for row in result["files"]] == ["success", "failed"]
        assert json.loads(status_path.read_text())["files"] == result["files"]
        assert not (work / "invalid.pdf").exists()
        compare(batch)
        assert hashlib.sha256(args.source.read_bytes()).hexdigest() == source_hash, "Source was modified"
        assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash, "Staged source was modified"
        report = {**comparison, "libreOfficeOnly": True, "singlePagination": True,
                  "batchPagination": True, "partialFailure": True, "sourceUnchanged": True}
        if args.output_dir:
            args.output_dir.mkdir(parents=True, exist_ok=False)
            for pdf in (single, batch):
                shutil.copyfile(pdf, args.output_dir / pdf.name)
            (args.output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

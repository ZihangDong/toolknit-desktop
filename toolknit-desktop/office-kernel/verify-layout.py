"""Measure every approved paragraph, preserving failures for kernel diagnosis."""
import argparse
import importlib.util
import json
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("fidelity", ROOT.parent / "scripts/test-word-to-pdf-fidelity.py")
fidelity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fidelity)


def verify(pdf, source, checks_path):
    checks = json.loads(checks_path.read_text(encoding="utf-8-sig"))
    rows = []
    matched = 0
    total = sum(len(check.get("paragraph", {}).get("expectedLines", [])) for check in checks["checks"])
    with pdfplumber.open(pdf) as document:
        pages = len(document.pages)
        images = sum(len(page.images) for page in document.pages)
        for check in checks["checks"]:
            row = {"page": check["page"]}
            try:
                page = document.pages[check["page"] - 1]
                if "crop" in check:
                    page = page.crop(tuple(check["crop"]))
                lines = [line["text"] for line in page.extract_text_lines()]
                paragraph = check.get("paragraph", {})
                expected = paragraph.get("expectedLines")
                if expected:
                    prefix = fidelity.normalized(expected[0])[:20]
                    start = next((i for i, line in enumerate(lines)
                                  if fidelity.normalized(line).startswith(prefix)), None)
                    actual = lines[start:start + len(expected)] if start is not None else []
                    count = sum(fidelity.normalized(a) == fidelity.normalized(b)
                                for a, b in zip(actual, expected))
                    matched += count
                    row.update(expectedLines=expected, actualLines=actual, matchedLines=count)
                    fidelity.compare_expected_lines(lines, expected, check["page"])
                # Reuse all existing strict assertions, including source content,
                # pagination, images and the non-paragraph checkpoint types.
                one = {**checks, "checks": [check]}
                import tempfile
                with tempfile.TemporaryDirectory(prefix="toolknit-checkpoint-") as folder:
                    path = Path(folder) / "check.json"
                    path.write_text(json.dumps(one), encoding="utf-8")
                    fidelity.compare_page_checks(pdf, source, path)
                row["passed"] = True
            except (AssertionError, IndexError) as error:
                row.update(passed=False, error=str(error))
            rows.append(row)
    return {"passed": bool(rows) and all(row["passed"] for row in rows),
            "pages": pages, "expectedPages": checks["pages"],
            "images": images, "expectedImages": checks["images"],
            "matchedLines": matched, "approvedLines": total, "checks": rows,
            "comparisonScope": "external approved checkpoints; not whole-document visual equality",
            "visualFidelityApproved": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--page-checks", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.pdf, args.source, args.page_checks)
    print(json.dumps(result, ensure_ascii=True, indent=2))
    raise SystemExit(0 if result["passed"] else 1)

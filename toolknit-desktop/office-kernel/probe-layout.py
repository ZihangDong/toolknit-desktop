"""Export with an explicit kernel and measure layout against external QA data.

Run with LibreOffice's UNO Python. References are read only after export and
never influence conversion. This diagnostic cannot approve a release.
"""
import argparse
from contextlib import nullcontext
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from runtime_info import runtime_info

ROOT = Path(__file__).resolve().parent
OFFICE = ROOT.parent / "src-tauri/resources/office"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--soffice", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--compatibility", choices=("none", "current"), default="none")
    parser.add_argument("--qa-python", type=Path, required=True,
                        help="Python with pdfplumber for independent verification after export")
    parser.add_argument("--page-checks", type=Path, required=True)
    args = parser.parse_args()
    import uno
    import unohelper
    sys.path.insert(0, str(OFFICE))
    spec = importlib.util.spec_from_file_location("word_driver", OFFICE / "word-to-pdf.py")
    driver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(driver)
    import word_layout

    source, engine = args.source.resolve(), args.soffice.resolve()
    if not source.is_file() or source.suffix.lower() != ".docx":
        raise ValueError("A source DOCX is required")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    pdf, report_path = output / "output.pdf", output / "report.json"
    if pdf.exists() or report_path.exists():
        raise FileExistsError("Use a fresh diagnostic output directory")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    flags = 0x08000000 if os.name == "nt" else 0
    report = {"sourceSha256": digest, "source": str(source), "pdf": str(pdf),
              "engine": runtime_info(engine),
              "pythonCompatibilityShimApplied": args.compatibility == "current",
              "visualFidelityApproved": False}
    os.environ.setdefault("SAL_USE_VCLPLUGIN", "svp")
    os.environ.setdefault("SAL_DISABLE_PRINTERLIST", "1")
    abort = driver.make_abort_handler(uno, unohelper)
    staged = word_layout.docx_import_source(str(source)) if args.compatibility == "current" else nullcontext(str(source))
    with tempfile.TemporaryDirectory(prefix="toolknit-kernel-layout-") as profile:
        with driver.writer_session(str(engine), profile) as desktop:
            with staged as import_source:
                document = desktop.loadComponentFromURL(uno.systemPathToFileUrl(import_source), "_blank", 0,
                    tuple(driver.prop(uno, key, value) for key, value in (
                        ("Hidden", True), ("ReadOnly", True), ("MacroExecutionMode", 0),
                        ("UpdateDocMode", 0), ("InteractionHandler", abort()))))
                if document is None:
                    raise RuntimeError("DOCX import failed")
                try:
                    if args.compatibility == "current":
                        report["compatibilityChanges"] = word_layout.apply_docx_layout_compatibility(document, str(source), uno)
                    document.reformat()
                    document.storeToURL(uno.systemPathToFileUrl(str(pdf)), (
                        driver.prop(uno, "FilterName", "writer_pdf_Export"), driver.prop(uno, "Overwrite", False)))
                finally:
                    document.close(True)
    report["sourceUnchanged"] = hashlib.sha256(source.read_bytes()).hexdigest() == digest
    # A separate non-UNO process reads the baseline only after the PDF exists.
    qa_environment = {key: value for key, value in os.environ.items()
                      if key.upper() not in ("PYTHONHOME", "PYTHONPATH")}
    result = subprocess.run([str(args.qa_python), "-I", str(ROOT / "verify-layout.py"),
                             "--pdf", str(pdf), "--source", str(source),
                             "--page-checks", str(args.page_checks.resolve())],
                            capture_output=True, timeout=120, creationflags=flags, env=qa_environment)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    try:
        report["verification"] = json.loads(result.stdout.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise RuntimeError("Independent PDF verification failed: " +
                           result.stderr.decode("utf-8", errors="replace")[-2000:]) from error
    report["passed"] = report["sourceUnchanged"] and report["verification"]["passed"]
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

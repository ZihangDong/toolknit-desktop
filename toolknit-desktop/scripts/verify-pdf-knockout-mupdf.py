"""Independently check knockout fixtures with an optional test-only PyMuPDF."""

import json
import sys
from pathlib import Path

import pymupdf


def pixels(file):
    with pymupdf.open(file) as document:
        return [page.get_pixmap(matrix=pymupdf.Matrix(4 / 3, 4 / 3)).samples for page in document]


def main(root, backdrop=False):
    results = []
    fixtures = (
        [("inherited", root, "isolated-control.pdf")]
        if backdrop
        else [(space, root / space, "without-knockout.pdf")
              for space in ("DeviceRGB", "DeviceGray", "DeviceCMYK")]
    )
    for space, fixture, control_name in fixtures:
        source, control, edited, reference = (
            pixels(fixture / name)
            for name in ("source.pdf", control_name, "edited.pdf", "reference.pdf")
        )
        assert all(len(pages) == 3 for pages in (source, control, edited, reference)), space
        for page, (original, no_knockout, actual, expected) in enumerate(
            zip(source, control, edited, reference), 1
        ):
            assert original != no_knockout, f"{space} page {page}: control had no visible effect"
            assert actual == expected, f"{space} page {page}: edited pixels differ from reference"
        results.append({"colorSpace": space, "referencePages": 3, "differentControlPages": 3})
    print(json.dumps({"muPdfVersion": pymupdf.version[1], "results": results}, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]), "--backdrop" in sys.argv[2:])

"""Render exported DWG's independent DXF beside the source PDF at one page scale.

Uses only the OFL font shipped in the conversion output. Requires the prototype
test, Poppler, ezdxf/Pillow/numpy and the repository's Node Sharp dependency.
"""
import argparse
import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

import ezdxf
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg
from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration
from ezdxf.fonts import fonts
from ezdxf.math import BoundingBox2d

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=Path, default=Path('tmp/tk016/prototype-qa/report.json'))
parser.add_argument('--snapshot', type=Path)
args = parser.parse_args()
report = json.loads(args.report.read_text(encoding='utf-8'))
root = args.report.parent / report['artifactRun']
output = root / 'font-render'
output.mkdir(exist_ok=True)
scenarios = [('unicode-text', 'chinese', True), ('mixed-glyph-widths', 'chinese-mixed', True),
             ('unicode-rotation-90', 'chinese-rotated', True), ('paper-mm', 'vector', False),
             ('compressed-text', 'compressed', False), ('expanded-text', 'expanded', False)]
sheet = Image.new('RGB', (1200, 6 * 210), '#eeeeee')
labels = ImageDraw.Draw(sheet)
results = []
for index, (name, source, same_font) in enumerate(scenarios):
    row = next(row for row in report['scenarios'] if row['scenario'] == name)
    drawing_file = root / row['artifact']
    metadata = json.loads((drawing_file.parent / 'conversion.json').read_text(encoding='utf-8'))
    page = metadata['pages'][0]
    fonts.font_manager.build([str(drawing_file.parent)], support_dirs=False)
    drawing = ezdxf.readfile(root / f'{name}-0.dxf')
    backend = svg.SVGBackend()
    Frontend(RenderContext(drawing), backend, config=Configuration(background_policy=BackgroundPolicy.WHITE)).draw_layout(drawing.modelspace(), finalize=True)
    # Explicit page box, not content extents: source and target use the same
    # origin, page scale and rotation so width changes cannot be hidden by zoom.
    ratio = page['height'] / page['width']
    width = 360 if ratio <= 1 else 240
    svg_text = backend.get_string(layout.Page(width, width * ratio, layout.Units.mm),
                                  render_box=BoundingBox2d([(0, 0), (page['width'], page['height'])]))
    svg_file, target_png = output / f'{name}.svg', output / f'{name}-dwg.png'
    svg_file.write_text(svg_text, encoding='utf-8')
    source_prefix = output / f'{name}-source'
    subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-scale-to', '2400', '-png',
                    str(root / 'inputs' / f'{source}.pdf'), str(source_prefix)], check=True, capture_output=True)
    source_image = Image.open(source_prefix.with_suffix('.png')).convert('RGB')
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    element = ET.fromstring(svg_text)
    element.set('width', str(source_image.width) + 'px')
    element.set('height', str(source_image.height) + 'px')
    # These previews contain only stroked geometry and TrueType glyph outlines.
    # ezdxf's generic SVG polygon backend defaults to evenodd, which XORs
    # overlapping font contours and cuts white seams into Chinese strokes.
    # TrueType outlines use nonzero winding; this changes only the QA preview,
    # never the font or DWG. Counter/hole correctness is checked against PDF.
    assert all(entity.dxftype() in ('LINE', 'SPLINE', 'TEXT') for entity in drawing.modelspace())
    for child in element.iter():
        if child.get('fill-rule') == 'evenodd':
            child.set('fill-rule', 'nonzero')
    svg_file.write_text(ET.tostring(element, encoding='unicode'), encoding='utf-8')
    subprocess.run(['node', '--input-type=module', '-e',
                    "import sharp from 'sharp'; await sharp(process.argv[1]).resize(Number(process.argv[3]),Number(process.argv[4]),{fit:'fill'}).png().toFile(process.argv[2]);",
                    str(svg_file), str(target_png), str(source_image.width), str(source_image.height)], check=True, capture_output=True)
    target_image = Image.open(target_png).convert('RGB')
    text = page['textLayout'][0]
    angle = text['rotation']
    along, normal = (math.cos(angle), math.sin(angle)), (-math.sin(angle), math.cos(angle))
    cap = text['capHeight']
    corners = [(text['start'][0] + along[0] * x + normal[0] * y,
                text['start'][1] + along[1] * x + normal[1] * y)
               for x in (-cap * .4, text['width'] + cap * .4) for y in (-cap * .6, cap * 1.6)]
    crop = (max(0, math.floor(min(p[0] for p in corners) * source_image.width / page['width'])),
            max(0, math.floor(source_image.height - max(p[1] for p in corners) * source_image.height / page['height'])),
            min(source_image.width, math.ceil(max(p[0] for p in corners) * source_image.width / page['width'])),
            min(source_image.height, math.ceil(source_image.height - min(p[1] for p in corners) * source_image.height / page['height'])))
    left, right = source_image.crop(crop), target_image.crop(crop)
    a, b = np.asarray(left.convert('L')) < 200, np.asarray(right.convert('L')) < 200
    assert a.sum() > 0 and b.sum() > 0
    # One-pixel boundary tolerance allows distinct rasterizers' antialiasing;
    # this still detects shifted glyphs, missing Chinese and wrong text widths.
    dilate_a = np.asarray(Image.fromarray(a.astype('uint8') * 255).filter(ImageFilter.MaxFilter(3))) > 0
    dilate_b = np.asarray(Image.fromarray(b.astype('uint8') * 255).filter(ImageFilter.MaxFilter(3))) > 0
    source_coverage = float(np.logical_and(a, dilate_b).sum() / a.sum())
    output_coverage = float(np.logical_and(b, dilate_a).sum() / b.sum())
    source_bbox = Image.fromarray(a.astype('uint8') * 255).getbbox()
    output_bbox = Image.fromarray(b.astype('uint8') * 255).getbbox()
    if same_font:
        assert source_coverage >= .995 and output_coverage >= .995, (name, source_coverage, output_coverage)
        assert max(abs(x - y) for x, y in zip(source_bbox, output_bbox)) <= 2, (name, source_bbox, output_bbox)
    for column, picture in enumerate((left, right)):
        picture.thumbnail((565, 170))
        sheet.paste(picture, (column * 600 + (600 - picture.width) // 2, index * 210 + 30 + (170 - picture.height) // 2))
    labels.text((12, index * 210 + 8), f'{name}: source PDF', fill='black')
    labels.text((612, index * 210 + 8), 'DWG -> LibreDWG DXF -> supplied font', fill='black')
    results.append({'scenario': name, 'sameSourceFont': same_font, 'sourceCoverageWithin1px': source_coverage,
                    'outputCoverageWithin1px': output_coverage, 'sourceInkBounds': source_bbox,
                    'outputInkBounds': output_bbox, 'missingGlyphs': row['missingGlyphs'],
                    'textWidthError': row['textWidthMaximumError']})
sheet.save(output / 'text-comparison.png')
summary = {'task': 'TK-016-A', 'scope': 'typography-render-verification', 'sourceRun': report['artifactRun'],
           'fontSha256': report['font']['sha256'], 'cases': results,
           'method': 'same-page-scale; 2400px longest side; TrueType nonzero winding; same-font glyph masks within 1px; 99.5% mutual coverage and <=2px ink-bound error',
           'status': 'shipped-font-render-checks-passed', 'interactiveCadAcceptance': 'not-tested'}
serialized = json.dumps(summary, ensure_ascii=False, indent=2) + '\n'
(args.report.parent / 'font-render-report.json').write_text(serialized, encoding='utf-8')
if args.snapshot:
    args.snapshot.write_text(serialized, encoding='utf-8')
print(f'{len(results)} same-page typography previews checked; {output / "text-comparison.png"}')

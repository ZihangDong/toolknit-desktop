"""TK-016 research fixtures and optional isolated LibreDWG smoke test.

This is not a general PDF-to-CAD converter. Only the deliberately simple
vector fixture is mapped to LINE/TEXT in DXF for a DWG writer feasibility test.
No engine is downloaded, installed, licensed, or bundled by this script.
Requires reportlab, pypdf, pdfplumber, Pillow (bundled Codex Python has them).
The optional engine test also requires ezdxf==1.4.3 in an isolated environment.
"""

import argparse
import hashlib
import io
import json
import math
import platform
from pathlib import Path
import subprocess

import pdfplumber
import pypdf
import reportlab
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from pypdf.generic import (
    ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject,
    NameObject, NumberObject, TextStringObject,
)
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fixture(root, name, draw):
    path = root / (name + '.pdf')
    pdf = canvas.Canvas(str(path), pagesize=(360, 240), invariant=1)
    draw(pdf)
    pdf.showPage()
    pdf.save()
    return path


def rewrite(source, target, change):
    writer = PdfWriter(clone_from=source)
    change(writer)
    with target.open('wb') as stream:
        writer.write(stream)


def inspect(path, password=None):
    reader = PdfReader(path)
    encrypted = reader.is_encrypted
    if encrypted:
        if not password or not reader.decrypt(password):
            return {'encrypted': True, 'status': 'password-required'}
    page = reader.pages[0]
    operators = page.get_contents().operations
    hidden_text = any(op == b'Tr' and args[0] == 3 for args, op in operators)
    with pdfplumber.open(path, password=password) as pdf:
        objects = pdf.pages[0]
        counts = {key: len(getattr(objects, key)) for key in ('lines', 'rects', 'curves', 'images', 'chars')}
    vector_paths = counts['lines'] + counts['rects'] + counts['curves']
    # Counts are evidence for these known fixtures, not a production classifier:
    # a scan may contain a vector border; glyph outlines may look like geometry.
    return {
        'status': 'readable', 'encrypted': encrypted, 'counts': counts,
        'has_paths': bool(vector_paths), 'has_images': bool(counts['images']),
        'has_text': bool(counts['chars']), 'has_invisible_text_operator': hidden_text,
        'media_box': list(map(float, page.mediabox)),
        'crop_box': list(map(float, page.cropbox)), 'rotation': page.rotation,
        'user_unit': float(page.get('/UserUnit', 1)),
        'optional_content_groups': len(reader.trailer['/Root'].get('/OCProperties', {}).get('/OCGs', [])),
    }


def simple_fixture_dxf(pdf_path, target, version):
    import ezdxf
    # Explicitly limited to the fixture: unrotated, no crop/clip, UserUnit=1,
    # one horizontal LINE and one ASCII string. No guessed drawing scale.
    with pdfplumber.open(pdf_path) as document:
        page = document.pages[0]
        assert len(page.lines) == 1 and not page.images and not page.curves
        line = page.lines[0]
        text = page.extract_text()
        assert text == 'Scale 1:1'
        char = page.chars[0]
        assert char['text'] == 'S' and char['matrix'][:4] == (1, 0, 0, 1)
        x, y = char['matrix'][4:6]
    factor = 25.4 / 72  # paper mm per PDF point, NOT inferred model units
    document = ezdxf.new(version)
    document.units = 4
    document.layers.new('PDF_GEOMETRY')
    model = document.modelspace()
    model.add_line((line['x0'] * factor, line['y0'] * factor),
                   (line['x1'] * factor, line['y1'] * factor), dxfattribs={'layer': 'PDF_GEOMETRY'})
    model.add_text(text, dxfattribs={'layer': 'PDF_GEOMETRY', 'height': char['size'] * factor,
                                   'insert': (x * factor, y * factor)})
    assert not document.audit().has_errors
    document.saveas(target)
    return math.hypot(line['x1'] - line['x0'], line['y1'] - line['y0']) * factor


def engine_test(engine_dir, root, vector_pdf):
    import ezdxf
    extension = '.exe' if platform.system() == 'Windows' else ''
    def run(name, *args):
        executable = engine_dir / (name + extension)
        result = subprocess.run([str(executable), *map(str, args)], cwd=root,
                                capture_output=True, text=True, errors='replace', timeout=30,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        (root / (name + '.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
        return result

    version = run('dxf2dwg', '--version')
    assert version.returncode == 0
    from tempfile import mkdtemp
    cases = []
    for source_version in ('R12', 'R2000'):
        # Retain each original output. Never silently fix an invalid roundtrip.
        attempt = Path(mkdtemp(prefix=source_version.lower() + '-', dir=root))
        source, dwg, roundtrip = attempt / 'paper-mm.dxf', attempt / 'simple.dwg', attempt / 'roundtrip.dxf'
        expected_length = simple_fixture_dxf(vector_pdf, source, source_version)
        assert math.isclose(expected_length, 25.4, abs_tol=1e-9)
        row = {'source_dxf_version': source_version, 'target_dwg_version': 'r2000',
               'input_ezdxf_audit_errors': len(ezdxf.readfile(source).audit().errors)}
        write = run('dxf2dwg', '--as', 'r2000', '-o', dwg, source)
        row['write_exit_code'] = write.returncode
        (attempt / 'write.log').write_text(write.stdout + write.stderr, encoding='utf-8')
        row['write_error_diagnostics'] = 'ERROR:' in write.stderr
        row['dwg_signature'] = dwg.read_bytes()[:6].decode('ascii', errors='replace') if dwg.exists() else None
        row['dwg_bytes'] = dwg.stat().st_size if dwg.exists() else 0
        if dwg.exists():
            json_path = attempt / 'dwg.json'
            decoded = run('dwgread', '-O', 'JSON', '-o', json_path, dwg)
            row['own_reader_exit_code'] = decoded.returncode
            if decoded.returncode == 0 and json_path.exists():
                try:
                    contents = json.loads(json_path.read_text(encoding='utf-8'))
                except json.JSONDecodeError as error:
                    row['own_reader_json_error'] = str(error)
                    contents = {}
                entities = contents.get('OBJECTS', [])
                actual_lines = [obj for obj in entities if obj.get('entity') == 'LINE']
                actual_texts = [obj for obj in entities if obj.get('entity') == 'TEXT']
                row['own_reader_line_count'] = len(actual_lines)
                row['own_reader_text_count'] = len(actual_texts)
                row['own_reader_units'] = contents.get('HEADER', {}).get('INSUNITS')
                if len(actual_lines) == len(actual_texts) == 1:
                    row['own_reader_line_length'] = math.dist(actual_lines[0]['start'], actual_lines[0]['end'])
                    row['own_reader_text'] = actual_texts[0].get('text_value')
                    assert math.isclose(row['own_reader_line_length'], 25.4, abs_tol=1e-6)
                    assert row['own_reader_text'] == 'Scale 1:1'
        read = run('dwg2dxf', '-o', roundtrip, dwg) if dwg.exists() else None
        row['read_exit_code'] = read.returncode if read else None
        if read:
            (attempt / 'read.log').write_text(read.stdout + read.stderr, encoding='utf-8')
        row['status'] = 'roundtrip-failed'
        if roundtrip.exists():
            try:
                document = ezdxf.readfile(roundtrip)
                audit = document.audit()
                lines = list(document.modelspace().query('LINE'))
                texts = list(document.modelspace().query('TEXT'))
                row.update({'dxf_audit_errors': len(audit.errors), 'dxf_audit_fixes': len(audit.fixes),
                            'line_count': len(lines), 'text_count': len(texts), 'units': document.units})
                if len(lines) == len(texts) == 1:
                    line, text = lines[0].dxf, texts[0].dxf
                    length = (line.end - line.start).magnitude
                    row.update({'line_length_mm': length, 'text': text.text, 'layer': line.layer})
                    if (write.returncode == read.returncode == 0 and row['dwg_signature'] == 'AC1015'
                            and not audit.has_errors and not audit.fixes and not row['write_error_diagnostics']
                            and math.isclose(length, expected_length, abs_tol=1e-6)
                            and math.isclose(line.start.x, 25.4, abs_tol=1e-6)
                            and math.isclose(line.start.y, 25.4, abs_tol=1e-6)
                            and text.text == 'Scale 1:1' and line.layer == text.layer == 'PDF_GEOMETRY'
                            and document.units == 4):
                        row['status'] = 'synthetic-smoke-passed'
            except (ValueError, ezdxf.DXFError) as error:
                row['independent_dxf_read_error'] = f'{type(error).__name__}: {error}'
        cases.append(row)
    # A DXF writer is not a PDF importer. Record actual behavior on valid PDF.
    rejection = run('dxf2dwg', '-o', attempt / 'direct-pdf.dwg', vector_pdf)
    archive = engine_dir.parent / 'libredwg-0.14-win64.zip'
    return {
        'status': 'synthetic-smoke-passed' if all(row['status'] == 'synthetic-smoke-passed' for row in cases) else 'not-production-ready',
        'version': version.stdout.strip(), 'cases': cases,
        'executable_sha256': sha256(engine_dir / ('dxf2dwg' + extension)),
        'local_archive_sha256': sha256(archive) if archive.exists() else None,
        'reference_archive_sha256': '1ad7e15344d20b3426c3435b078d82fb84b35062815946b2cca9c5fc9810fea8',
        'reference_archive_url': 'https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14-win64.zip',
        'dxf_validator': 'ezdxf ' + ezdxf.__version__,
        'direct_pdf_exit_code': rejection.returncode,
        'direct_pdf_created_output': (attempt / 'direct-pdf.dwg').exists(),
        'independent_cad_open': 'not-tested',
        'scope': 'one synthetic LINE and ASCII TEXT; same-engine DXF roundtrip only',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'tmp/tk016')
    parser.add_argument('--engine-dir', type=Path)
    parser.add_argument('--snapshot', type=Path, help='Optional tracked JSON evidence destination')
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    fixtures = root / 'fixtures'
    fixtures.mkdir(exist_ok=True)
    image = Image.new('RGB', (720, 480), 'white')
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((60, 60, 600, 350), outline='black', width=4)
    drawing.line((60, 200, 500, 200), fill='black', width=3)
    drawing.text((80, 100), 'SCANNED PLAN - pixels only', fill='black')
    image_bytes = io.BytesIO()
    image.save(image_bytes, format='PNG')

    def scan(pdf):
        pdf.drawImage(ImageReader(io.BytesIO(image_bytes.getvalue())), 0, 0, 360, 240)

    def vector(pdf):
        pdf.line(72, 72, 144, 72)
        pdf.drawString(72, 110, 'Scale 1:1')

    def mixed(pdf):
        scan(pdf)
        pdf.line(72, 72, 144, 72)

    def searchable_scan(pdf):
        scan(pdf)
        text = pdf.beginText(40, 180)
        text.setTextRenderMode(3)
        text.textOut('OCR SEARCH TEXT')
        pdf.drawText(text)

    def curves(pdf):
        pdf.setDash(4, 2)
        pdf.circle(100, 100, 30)
        pdf.bezier(10, 20, 70, 180, 180, 20, 300, 200)
        clip = pdf.beginPath()
        clip.rect(60, 60, 200, 120)
        pdf.clipPath(clip, stroke=0)
        pdf.line(0, 0, 360, 240)

    paths = {
        'vector': fixture(fixtures, 'vector', vector),
        'scan': fixture(fixtures, 'scan', scan),
        'mixed': fixture(fixtures, 'mixed', mixed),
        'searchable-scan': fixture(fixtures, 'searchable-scan', searchable_scan),
        'curves-clipping': fixture(fixtures, 'curves-clipping', curves),
        'outline-like': fixture(fixtures, 'outline-like', lambda pdf: pdf.rect(72, 72, 20, 40)),
        'blank': fixture(fixtures, 'blank', lambda pdf: None),
    }
    for name, change in [
        ('rotated', lambda writer: writer.pages[0].rotate(90)),
        ('cropped', lambda writer: setattr(writer.pages[0], 'cropbox', pypdf.generic.RectangleObject([36, 24, 324, 216]))),
        ('user-unit', lambda writer: writer.pages[0].__setitem__(NameObject('/UserUnit'), FloatObject(2))),
        ('encrypted', lambda writer: writer.encrypt('synthetic-password', algorithm='AES-256')),
    ]:
        paths[name] = fixtures / (name + '.pdf')
        rewrite(paths['vector'], paths[name], change)

    def layers(writer):
        group = DictionaryObject({NameObject('/Type'): NameObject('/OCG'), NameObject('/Name'): TextStringObject('Geometry')})
        reference = writer._add_object(group)
        groups = ArrayObject([reference])
        writer._root_object[NameObject('/OCProperties')] = DictionaryObject({
            NameObject('/OCGs'): groups,
            NameObject('/D'): DictionaryObject({NameObject('/Order'): groups, NameObject('/ON'): groups}),
        })
        page = writer.pages[0]
        page['/Resources'][NameObject('/Properties')] = DictionaryObject({NameObject('/Geometry'): reference})
        stream = DecodedStreamObject()
        stream.set_data(b'/OC /Geometry BDC\n' + page.get_contents().get_data() + b'\nEMC\n')
        page[NameObject('/Contents')] = writer._add_object(stream)

    paths['layers'] = fixtures / 'layers.pdf'
    rewrite(paths['vector'], paths['layers'], layers)
    paths['malformed'] = fixtures / 'malformed.pdf'
    paths['malformed'].write_bytes(b'not a PDF\n')
    rows = {}
    for name, path in paths.items():
        if name == 'malformed':
            try:
                inspect(path)
                raise AssertionError('Malformed input was accepted')
            except PdfReadError:
                rows[name] = {'status': 'invalid-pdf'}
        else:
            rows[name] = inspect(path)
        rows[name]['sha256'] = sha256(path)

    assert rows['vector']['has_paths'] and rows['vector']['has_text'] and not rows['vector']['has_images']
    assert rows['scan']['has_images'] and not rows['scan']['has_paths'] and not rows['scan']['has_text']
    assert rows['mixed']['has_images'] and rows['mixed']['has_paths']
    assert rows['searchable-scan']['has_text'] and rows['searchable-scan']['has_invisible_text_operator']
    assert not rows['searchable-scan']['has_paths']
    assert rows['outline-like']['has_paths'] and not rows['outline-like']['has_text']
    assert rows['curves-clipping']['counts']['curves'] == 2
    assert rows['blank']['counts'] == dict.fromkeys(('lines', 'rects', 'curves', 'images', 'chars'), 0)
    assert rows['rotated']['rotation'] == 90
    assert rows['cropped']['crop_box'] == [36, 24, 324, 216]
    assert rows['user-unit']['user_unit'] == 2
    assert rows['layers']['optional_content_groups'] == 1
    assert rows['encrypted']['status'] == 'password-required'
    decrypted = inspect(paths['encrypted'], 'synthetic-password')
    assert decrypted['has_paths'] and decrypted['has_text']
    rows['encrypted']['correct_password_status'] = decrypted['status']
    # Check physical paper length arithmetic; rotation/crop were read above,
    # not converted to CAD. This does not validate their coordinate conversion.
    assert math.isclose(72 * rows['user-unit']['user_unit'] * 25.4 / 72, 50.8)
    engine = engine_test(args.engine_dir.resolve(), root, paths['vector']) if args.engine_dir else {'status': 'not-run'}
    for name, path in paths.items():
        assert sha256(path) == rows[name]['sha256'], f'Source changed: {name}'
    report = {
        'task': 'TK-016', 'scope': 'research-only',
        'runtime': {'python': platform.python_version(), 'reportlab': reportlab.Version,
                    'pypdf': pypdf.__version__, 'pdfplumber': pdfplumber.__version__},
        'fixture_count': len(rows), 'fixtures': rows, 'engine': engine,
        'limits': ['synthetic inputs only', 'no production PDF classifier',
                   'no general PDF-to-DXF converter', 'no independent CAD DWG interoperability test',
                   'no commercial SDK trial or redistribution authorization', 'no desktop UI implemented'],
    }
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    (root / 'report.json').write_text(serialized, encoding='utf-8')
    if args.snapshot:
        args.snapshot.resolve().write_text(serialized, encoding='utf-8')
    print(f'TK-016: {len(rows)} PDF fixtures passed; engine={engine["status"]}; {root / "report.json"}')


if __name__ == '__main__':
    main()

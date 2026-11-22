"""Independently inspect LibreDWG's DXF with FontTools/ezdxf.

Only fonts actually shipped beside the DWG are registered in this process.
No system font is installed and no source PDF font program is redistributed.
"""
import hashlib
import json
from pathlib import Path
import sys

import ezdxf
from ezdxf.fonts import fonts

source, directory = Path(sys.argv[1]), Path(sys.argv[2]).resolve()
document = ezdxf.readfile(source)
audit = document.audit()
fonts.font_manager.build([str(directory)], support_dirs=False)
objects = []
for entity in document.modelspace():
    value = {'type': entity.dxftype(), 'layer': entity.dxf.layer,
             'color': list(entity.rgb) if entity.rgb else None}
    if entity.dxftype() == 'LINE':
        value.update(start=list(entity.dxf.start), end=list(entity.dxf.end))
    elif entity.dxftype() == 'SPLINE':
        value.update(controls=[list(point) for point in entity.control_points],
                     knots=list(entity.knots), degree=entity.dxf.degree)
    elif entity.dxftype() == 'TEXT':
        filename = document.styles.get(entity.dxf.style).dxf.font
        assert Path(filename).name == filename and (directory / filename).is_file()
        resolved = fonts.font_manager._font_cache.get(filename, filename).file_path.resolve()
        assert resolved == directory / filename, 'Renderer substituted an unrelated font'
        font = fonts.font_manager.get_ttf_font(filename)
        cmap = font.getBestCmap()
        missing = [f'U+{ord(character):04X}' for character in entity.dxf.text
                   if cmap.get(ord(character), '.notdef') == '.notdef']
        assert not missing, missing
        measured = fonts.TrueTypeFont(filename, entity.dxf.height, entity.dxf.width)
        value.update(text=entity.dxf.text, insert=list(entity.dxf.insert),
                     height=entity.dxf.height, rotation=entity.dxf.rotation,
                     widthFactor=entity.dxf.width, measuredWidth=measured.text_width(entity.dxf.text),
                     font=filename, glyphs=len(entity.dxf.text), missingGlyphs=missing,
                     fontSha256=hashlib.sha256(resolved.read_bytes()).hexdigest())
    objects.append(value)
print(json.dumps({'errors': len(audit.errors), 'fixes': len(audit.fixes),
                  'units': document.units, 'objects': objects}, ensure_ascii=True))

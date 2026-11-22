import JSZip from 'jszip';
import { buildContentTypes, buildPresentationRels, buildPresentationXml, buildSlideXml, docPropsApp, docPropsCore,
  rootRels, simpleThemeXml, slideLayoutXml, slideMasterXml } from '../../ppt-draft-package.js';
import { PDF_PPT_LIMITS, fitPptImage, pptError, pptSlideSize, validatePptPages } from './core.js';

const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const relationships = content => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
const link = (id, type, target) => `<Relationship Id="${id}" Type="${rel}${type}" Target="${target}"/>`;
const theme = { name: 'PDF Pages', background: 'FFFFFF', text: '191919', panel: 'FFFFFF', panelAlt: 'FFFFFF', accent: '191919', accentSoft: 'EEEEEE', line: 'D9D9D9', muted: '606266' };

/** A page is one embedded PNG picture, with an editable picture transform. */
export function createImagePresentation({ width, height, count, title }) {
  validatePptPages(count);
  const size = pptSlideSize(width, height), zip = new JSZip();
  let index = 0, mediaBytes = 0;
  zip.file('_rels/.rels', rootRels());
  zip.file('docProps/core.xml', docPropsCore(title));
  zip.file('docProps/app.xml', docPropsApp(count, 'PDF page aspect ratio'));
  zip.file('ppt/presentation.xml', buildPresentationXml(count, size));
  zip.file('ppt/_rels/presentation.xml.rels', buildPresentationRels(count));
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMasterXml(theme));
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships(link('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') + link('rId2', 'theme', '../theme/theme1.xml')));
  zip.file('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships(link('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')));
  zip.file('ppt/theme/theme1.xml', simpleThemeXml(theme));
  zip.file('[Content_Types].xml', buildContentTypes(count, ['png']));
  return {
    add({ bytes, width, height, pageNumber }) {
      if (index >= count) throw pptError('invalid');
      if (!(bytes instanceof Uint8Array) || bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) throw pptError('invalid');
      mediaBytes += bytes.length;
      if (mediaBytes > PDF_PPT_LIMITS.outputBytes) throw pptError('output-large');
      const box = fitPptImage(width, height, size);
      index++;
      const number = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : index;
      const picture = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="PDF page ${number}" descr="PDF page ${number}; rendered image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      zip.file(`ppt/slides/slide${index}.xml`, buildSlideXml(picture, theme));
      zip.file(`ppt/slides/_rels/slide${index}.xml.rels`, relationships(link('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml') + link('rId2', 'image', `../media/page${index}.png`)));
      zip.file(`ppt/media/page${index}.png`, bytes, { compression: 'STORE' });
    },
    async finish() {
      if (index !== count) throw pptError('invalid');
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      if (bytes.length > PDF_PPT_LIMITS.outputBytes) throw pptError('output-large');
      return bytes;
    }
  };
}

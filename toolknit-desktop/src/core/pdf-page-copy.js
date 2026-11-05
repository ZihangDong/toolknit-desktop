import { PDFArray, PDFDict, PDFName, PDFObjectCopier, PDFPage } from 'pdf-lib';

const copiers = new WeakMap();

/** Reuse resource references across page copies into the same output document. */
export async function copyPdfPages(output, source, indices) {
  await source.flush();
  let sources = copiers.get(output);
  if (!sources) { sources = new WeakMap(); copiers.set(output, sources); }
  let copier = sources.get(source);
  if (!copier) {
    copier = PDFObjectCopier.for(source.context, output.context);
    sources.set(source, copier);
  }
  return indices.map(index => {
    if (!Number.isInteger(index) || index < 0 || index >= source.getPageCount()) {
      throw new Error('PDF page index is outside the source document');
    }
    const donor = source.getPage(index).node.clone();
    // PieceInfo is application-private round-trip data, not painting content.
    // It can contain the entire design source and is stale in a derived PDF.
    donor.delete(PDFName.of('PieceInfo'));
    const node = copier.copy(donor);
    // Page-local mutable containers must remain independent when the same page
    // is duplicated and edited. Stream/font/image payloads still share refs.
    for (const key of ['Contents', 'Annots']) {
      const value = node.lookup(PDFName.of(key));
      if (value instanceof PDFArray) node.set(PDFName.of(key), value.clone(output.context));
    }
    const resources = node.lookup(PDFName.of('Resources'));
    if (resources instanceof PDFDict) {
      const ownResources = resources.clone(output.context);
      for (const key of ['Font', 'XObject', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading', 'Properties']) {
        const value = resources.lookup(PDFName.of(key));
        if (value instanceof PDFDict) ownResources.set(PDFName.of(key), value.clone(output.context));
      }
      node.set(PDFName.of('Resources'), ownResources);
    }
    return PDFPage.of(node, output.context.register(node), output);
  });
}

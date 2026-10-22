import yauzl from 'yauzl';
import { xml2js } from 'xml-js';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

export async function inspectWorkbookArchive(bytes, signal) {
  throwIfAborted(signal);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error ? reject(new ToolKnitError('INPUT_INVALID', 'Workbook is not a readable ZIP archive.')) : resolve(zip)));
  return new Promise((resolve, reject) => {
    let expanded = 0, entries = 0, finished = false, workbook = false, contentTypes = false, activeStream;
    const names = new Set();
    const finish = error => {
      if (finished) return; finished = true; activeStream?.destroy(); zip.close(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve({ entries, expanded_bytes: expanded });
    };
    const invalid = message => new ToolKnitError('INPUT_INVALID', message);
    const abort = () => finish(new ToolKnitError('CANCELLED', 'Workbook inspection cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    zip.on('error', () => finish(invalid('Workbook archive is damaged.')));
    zip.on('end', () => finish(!workbook || !contentTypes ? invalid('Workbook package parts are missing.') : null));
    zip.on('entry', entry => {
      if (finished) return;
      expanded += entry.uncompressedSize; entries++;
      const name = entry.fileName;
      if (entries > 10000 || expanded > 256 * 1024 * 1024 || entry.uncompressedSize > 32 * 1024 * 1024) { finish(invalid('Workbook archive exceeds entry or expanded-size limits.')); return; }
      if (names.has(name) || entry.isEncrypted() || /(?:^|\/)(?:\.\.|\.)\//.test(name) || name.includes('\\')) { finish(invalid('Workbook contains duplicate, encrypted or unsafe archive paths.')); return; }
      names.add(name); workbook ||= name === 'xl/workbook.xml'; contentTypes ||= name === '[Content_Types].xml';
      if (/vbaProject|activeX|xl\/(?:embeddings|externalLinks|queryTables)\/|xl\/connections\.xml/i.test(name)) { finish(invalid('Workbooks with macros, embedded objects or external data are not supported.')); return; }
      if (!/\.(?:xml|rels)$/.test(name)) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (finished) { stream?.destroy(); return; }
        if (error) { finish(invalid('Workbook part cannot be read.')); return; }
        activeStream = stream; let count = 0; const parts = [];
        stream.on('data', part => { count += part.length; if (count > Math.min(entry.uncompressedSize, 32 * 1024 * 1024)) { finish(invalid('Expanded workbook part exceeds limits.')); return; } parts.push(part); });
        stream.on('error', () => finish(invalid('Workbook part has invalid compressed data.')));
        stream.on('end', () => {
          if (finished) return;
          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
            if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid('XML entity declarations are not supported.');
            const parsed = xml2js(text);
            const visit = node => {
              const tag = node.name?.split(':').at(-1), attributes = node.attributes || {};
              if (tag === 'Relationship' && attributes.TargetMode === 'External' && !String(attributes.Type || '').endsWith('/hyperlink')) throw invalid('External workbook data references are not supported.');
              if (tag === 'f') {
                const formula = (node.elements || []).map(item => item.text || item.cdata || '').join('');
                const expression = formula.replace(/"(?:[^"]|"")*"/g, '""');
                const externalReference = /\[[^\]]+\][^!+\-*/(),;\[\]]{0,255}!|\|[^!]{0,255}!/;
                if (externalReference.test(expression) || /(?:WEBSERVICE|DDE|RTD|HYPERLINK|IMPORTXML|IMPORTDATA|INDIRECT|IMAGE|STOCKHISTORY)\s*\(/i.test(expression)) throw invalid('Workbook contains external or dynamic data formulas.');
              }
              for (const child of node.elements || []) visit(child);
            };
            visit(parsed);
          } catch (error) { finish(error instanceof ToolKnitError ? error : invalid('Workbook XML is invalid.')); return; }
          activeStream = null; zip.readEntry();
        });
      });
    });
    if (signal?.aborted) abort(); else zip.readEntry();
  });
}

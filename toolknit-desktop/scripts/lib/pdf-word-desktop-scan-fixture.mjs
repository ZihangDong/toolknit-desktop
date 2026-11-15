/** Real desktop converter/editor, with an explicitly injected OCR test boundary. */
export function desktopScanFixtureMarkup() {
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="/src/styles/index.css"><link rel="stylesheet" href="/src/styles/themes/index.css">
  </head><body><script type="module">
  import markup from '/src/features/pdf-to-word/template.js';
  import '/src/features/pdf-to-word/pdf-to-word.css';
  import {createPdfWordController} from '/src/features/pdf-to-word/controller.js';
  import {createWordDocumentEditor} from '/src/features/pdf-to-word/document-editor.js';
  document.body.insertAdjacentHTML('beforeend',markup);
  window.scanPackets=[];window.scanScenes=[];window.scanFinishes=[];window.scanRaw=[];window.scanWorkers=new Set();
  const Native=Worker;
  window.Worker=class extends Native {
    constructor(...args){super(...args);scanWorkers.add(this);}
    terminate(){scanWorkers.delete(this);super.terminate();}
    postMessage(data,...args){if(data.type==='ocr')scanPackets.push({preserveScanFigures:data.preserveScanFigures,refineScanText:data.refineScanText});
      if(data.type==='page')scanScenes.push(structuredClone(data.scene));
      if(data.type==='finish')scanFinishes.push(structuredClone(data.document));return super.postMessage(data,...args);}
  };
  const editor=createWordDocumentEditor();
  const controller=createPdfWordController({overlay:document.getElementById('pdfWordOverlay'),isTauri:false,
    recognizePage:async(canvas,signal)=>{scanRaw.push(canvas.toDataURL('image/png'));
      if(window.scanOcrResult)return structuredClone(window.scanOcrResult);
      const response=await fetch('/__lab/ocr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:canvas.toDataURL('image/png')}),signal});
      const result=await response.json();if(!response.ok)throw Error('local OCR failed');return result;},
    openDocumentEditor:async session=>{controller.close();editor.open(session);}});
  window.desktopScan={controller,editor};controller.open();
  </script></body></html>`;
}

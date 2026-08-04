import * as fontkit from 'fontkit';

function createEncodedSubsetStream(subset) {
  const listeners = {
    data: [],
    end: [],
    error: []
  };
  const stream = {
    on(event, listener) {
      listeners[event]?.push(listener);
      return stream;
    }
  };

  queueMicrotask(() => {
    try {
      const bytes = subset.encode();
      for (const listener of listeners.data) listener(bytes);
      for (const listener of listeners.end) listener();
    } catch (error) {
      for (const listener of listeners.error) listener(error);
    }
  });

  return stream;
}

// pdf-lib expects the streaming subset API removed by fontkit 2.x.
const pdfLibFontkit = {
  create(fontBytes, postscriptName) {
    const font = fontkit.create(fontBytes, postscriptName);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      subset.encodeStream = () => createEncodedSubsetStream(subset);
      return subset;
    };
    return font;
  }
};

export default pdfLibFontkit;

const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** Send bytes without expanding them into a JSON number array. */
export function writeUniqueBinaryFile(invoke, { directory, fileName, bytes }) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error('Output file is empty or exceeds the 512MB limit');
  }
  const metadata = new TextEncoder().encode(JSON.stringify({ directory, fileName }));
  if (metadata.length > 6000) throw new Error('Output path is too long');
  const encoded = btoa(String.fromCharCode(...metadata));
  return invoke('write_unique_file_binary', bytes, { headers: { 'x-toolknit-output': encoded } });
}

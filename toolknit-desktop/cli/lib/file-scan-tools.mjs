import { operation, schema, inputPath, integer } from './operation-schema.mjs';
const fields = { directory: inputPath, max_files: integer(1, 20000), max_depth: integer(0, 32), limit: integer(1, 500) };
export const FILE_SCAN_OPERATIONS = [
  operation('files_large', ['files', 'large'], 'Read-only bounded scan of one explicit directory for large files. Never deletes, follows links or scans implicit system locations. Reports truncated/skipped counts; sizes are bytes.',
    schema({ ...fields, minimum_bytes: integer(0, Number.MAX_SAFE_INTEGER) }, ['directory']), './file-scan-runtime.mjs', 'files_large'),
  operation('files_duplicates', ['files', 'duplicates'], 'Read-only scan for byte-identical file duplicates using size then SHA-256. Does not delete anything. Skips symlinks, caps per-file hashing at 256 MiB and total hashing at 2 GiB, and reports incomplete scans.',
    schema(fields, ['directory']), './file-scan-runtime.mjs', 'files_duplicates')
];

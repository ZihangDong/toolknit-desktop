// Explicit, credential-free public metadata check. Never sends a completion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readResponseTextLimited } from '../src/core/bounded-response.js';

const directory = new URL('../tmp/orcarouter/', import.meta.url);
const report = { checkedAt: new Date().toISOString(), scope: 'public-documents-and-unauthenticated-model-catalog-only',
  authorizationSent: false, authenticatedCompletion: 'unverified', documents: [] };
for (const part of ['getting-started/quickstart', 'getting-started/models', 'getting-started/get-api-key',
  'native-formats/openai-compat', 'api-reference/chat/create-a-chat-completion', 'operations/errors']) {
  const url = `https://docs.orcarouter.ai/${part}.md`;
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'error' });
  assert.equal(response.status, 200);
  const bytes = await readResponseTextLimited(response, 2 * 1024 * 1024);
  report.documents.push({ url, status: response.status, bytes: Buffer.byteLength(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex') });
}
const url = 'https://api.orcarouter.ai/v1/models';
const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'error' });
const bytes = await readResponseTextLimited(response, 2 * 1024 * 1024);
report.models = { url, status: response.status, bytes: Buffer.byteLength(bytes) };
if (response.ok) {
  const data = JSON.parse(bytes);
  assert.ok(Array.isArray(data.data));
  report.models.count = data.data.length;
  const example = data.data.find(model => model.id === 'openai/gpt-4o-mini');
  report.models.example = example ? { id: example.id, supported_endpoint_types: example.supported_endpoint_types,
    supported_parameters: example.supported_parameters } : null;
}
await mkdir(directory, { recursive: true });
await writeFile(new URL('public-probe.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

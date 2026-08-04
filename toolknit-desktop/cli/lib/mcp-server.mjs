import { errorPayload, ToolKnitError } from './errors.mjs';
import { executeTool, listTools } from './tool-registry.mjs';

const SERVER_INFO = Object.freeze({ name: 'toolknit', version: '1.2.8' });
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolErrorResult(error) {
  const payload = errorPayload(error);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true
  };
}

export function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';
  let initialized = false;

  const write = message => output.write(`${JSON.stringify(message)}\n`);
  const handle = async message => {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      write(rpcError(message?.id, -32600, 'Invalid JSON-RPC request.'));
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    try {
      if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        initialized = true;
        if (hasId) {
          write(response(message.id, {
            protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          instructions: 'ToolKnit only processes explicit local paths. In an IDE, when the user says current project or workspace, resolve the IDE workspace root and pass an absolute path inside <workspace>/toolknit-output; never rely on the MCP process working directory. Resolve project-relative input and image paths against that same workspace root. Always inspect file inputs first, never set overwrite=true unless the user explicitly requests replacement, and never place an AI provider key in tool arguments or chat messages. Audio, video, and image-stitch outputs require an explicit output_dir; they preserve sources and publish only completed unique outputs. For image stitching, preserve input_paths order exactly unless the user explicitly requests reordering, default to vertical/first/0px/PNG, and never guess a background or gap. For offline transcription, call toolknit_model_list first and ask the user before calling the large-file model installer. toolknit_transcribe always preserves original JSON, SRT, and TXT; refine=true sends only recognized subtitle text to the configured provider and must preserve every subtitle ID and timecode. For editable AI documents, report the per-page high-resolution numbered map paths and inspect stable controls before editing. Use update_style for one stable control and update_document_style for a document-wide typography/color/alignment rule; use types only when the user clearly scopes the rule. For editable AI tables, report the project path plus stable row, column, and chart numbers before editing. A semantic target may be mapped to a control or table item only when its text/type identifies exactly one item; ask the user when the match is ambiguous. Dry-run the exact operations, report diagnostics, and only then commit the same operations. Image insertion requires an absolute local PNG or JPEG path; never send base64 image data.'
          }));
        }
        return;
      }
      if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
      if (!initialized) {
        if (hasId) write(rpcError(message.id, -32002, 'Initialize the MCP session before calling tools.'));
        return;
      }
      if (message.method === 'ping') {
        if (hasId) write(response(message.id, {}));
        return;
      }
      if (message.method === 'tools/list') {
        if (hasId) write(response(message.id, { tools: listTools() }));
        return;
      }
      if (message.method === 'tools/call') {
        if (!hasId) return;
        const name = message.params?.name;
        const progressToken = message.params?._meta?.progressToken;
        const reportProgress = (progress, messageText) => {
          if (progressToken === undefined) return;
          write({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: { progressToken, progress, total: 100, message: messageText }
          });
        };
        try {
          reportProgress(0, 'ToolKnit started processing the requested files.');
          const result = await executeTool(name, message.params?.arguments ?? {}, { reportProgress });
          reportProgress(100, 'ToolKnit completed processing.');
          write(response(message.id, {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, result }) }],
            structuredContent: { ok: true, result },
            isError: false
          }));
        } catch (error) {
          reportProgress(100, 'ToolKnit stopped because the request could not be completed.');
          write(response(message.id, toolErrorResult(error)));
        }
        return;
      }
      if (hasId) write(rpcError(message.id, -32601, `Unsupported MCP method: ${message.method}`));
    } catch (error) {
      if (hasId) write(rpcError(message.id, -32603, 'ToolKnit MCP server error.', error instanceof ToolKnitError ? { code: error.code } : undefined));
    }
  };

  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let lineEnd;
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write(rpcError(null, -32700, 'Invalid JSON. MCP stdio messages must be one JSON-RPC object per line.'));
        continue;
      }
      void handle(message);
    }
  });
}

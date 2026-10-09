import { errorPayload, ToolKnitError } from './errors.mjs';
import { executeTool, listTools } from './tool-registry.mjs';

const SERVER_INFO = Object.freeze({ name: 'toolknit', version: '3.1.0' });
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const MAX_MCP_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_ACTIVE_TOOL_CALLS = 4;

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

export function startMcpServer({ input = process.stdin, output = process.stdout, execute = executeTool, list = listTools } = {}) {
  let buffer = '';
  let initialized = false;
  const activeCalls = new Map();

  const write = message => output.write(`${JSON.stringify(message)}\n`);
  const handle = async message => {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      write(rpcError(message?.id, -32600, 'Invalid JSON-RPC request.'));
      return;
    }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    if (hasId && message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number') {
      write(rpcError(null, -32600, 'JSON-RPC id must be a string, number, or null.'));
      return;
    }
    try {
      if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        initialized = true;
        if (hasId) {
          write(response(message.id, {
            protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
          instructions: 'ToolKnit only processes explicit local paths. In an IDE, when the user says current project or workspace, resolve the IDE workspace root and pass an absolute path inside <workspace>/toolknit-output; never rely on the MCP process working directory. Resolve project-relative input and image paths against that same workspace root. Always inspect file inputs first, never set overwrite=true unless the user explicitly requests replacement, and never place an AI provider key in tool arguments or chat messages. Audio, video, PDF-to-image, image-stitch, and PPT output tools require an explicit output_dir; they preserve sources and publish only completed unique outputs. For PDF to image, use toolknit_pdf_to_image for either per-page images or long stitched images; preserve the user order exactly, default to images/PNG/high, and never guess pages, format, or background. For PPT text, use toolknit_ppt_text to extract titles, body, and notes; ai_mode sends only extracted text, never the PPTX file, to the configured provider. For PPT compression, use toolknit_ppt_compress with level medium by default; low is lossless, medium/high may recompress large images but never modify the source PPTX and keep originals when recompression does not reduce size. For PPT to PDF, use toolknit_ppt_to_pdf; it requires LibreOffice/soffice, pre-validates PPTX, writes a PDF plus manifest into a unique folder, and never modifies the source. For PPT to image, use toolknit_ppt_to_image; default to PNG/high/all slides unless the user asks for specific pages, format, or clarity. It renders through LibreOffice to a temporary PDF, exports per-page images, and removes the temporary PDF. For PPT outline generation, use toolknit_ppt_outline only from a text brief; it does not read or upload PPTX and it does not generate PPTX files. It may also take deck_type to plan a product launch, pitch, report, training, or review narrative. For editable PPTX drafts, use toolknit_ppt_draft; prompt mode sends only the brief text to AI and writes the PPTX locally, while outline/outline_path mode does not call AI. It creates a first-stage editable draft, not animations or pixel-perfect enterprise template reproduction. For read-only hardware inspection, use the toolknit_hardware_* tools when the user asks about this computer; these tools take no file paths, write no files, and are currently Windows-focused. For image stitching, preserve input_paths order exactly unless the user explicitly requests reordering, default to vertical/first/0px/PNG, and never guess a background or gap. For offline transcription, call toolknit_model_list first and ask the user before calling the large-file model installer. toolknit_transcribe always preserves original JSON, SRT, and TXT; refine=true sends only recognized subtitle text to the configured provider and must preserve every subtitle ID and timecode. For editable AI documents, report the per-page high-resolution numbered map paths and inspect stable controls before editing. Use update_style for one stable control and update_document_style for a document-wide typography/color/alignment rule; use types only when the user clearly scopes the rule. For editable AI tables, report the project path plus stable row, column, and chart numbers before editing. A semantic target may be mapped to a control or table item only when its text/type identifies exactly one item; ask the user when the match is ambiguous. Dry-run the exact operations, report diagnostics, and only then commit the same operations. Image insertion requires an absolute local PNG or JPEG path; never send base64 image data.'
          }));
        }
        return;
      }
      if (message.method === 'notifications/initialized') return;
      if (message.method === 'notifications/cancelled') {
        const requestId = message.params?.requestId;
        const controller = activeCalls.get(requestId);
        if (controller && !controller.signal.aborted) {
          const reason = message.params?.reason;
          const text = typeof reason === 'string'
            ? reason
            : (reason && typeof reason.message === 'string' ? reason.message : 'MCP request cancelled.');
          controller.abort(text || 'MCP request cancelled.');
        }
        return;
      }
      if (!initialized) {
        if (hasId) write(rpcError(message.id, -32002, 'Initialize the MCP session before calling tools.'));
        return;
      }
      if (message.method === 'ping') {
        if (hasId) write(response(message.id, {}));
        return;
      }
      if (message.method === 'tools/list') {
        if (hasId) write(response(message.id, { tools: list() }));
        return;
      }
      if (message.method === 'tools/call') {
        if (!hasId) return;
        if (activeCalls.has(message.id)) {
          write(rpcError(message.id, -32600, 'A tool call with this request id is already active.'));
          return;
        }
        if (activeCalls.size >= MAX_ACTIVE_TOOL_CALLS) {
          write(rpcError(message.id, -32000, 'Too many ToolKnit tool calls are active.'));
          return;
        }
        const name = message.params?.name;
        const progressToken = message.params?._meta?.progressToken;
        const controller = new AbortController();
        activeCalls.set(message.id, controller);
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
          const result = await execute(name, message.params?.arguments ?? {}, {
            reportProgress,
            signal: controller.signal
          });
          reportProgress(100, 'ToolKnit completed processing.');
          write(response(message.id, {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, result }) }],
            structuredContent: { ok: true, result },
            isError: false
          }));
        } catch (error) {
          reportProgress(100, 'ToolKnit stopped because the request could not be completed.');
          write(response(message.id, toolErrorResult(error)));
        } finally {
          if (activeCalls.get(message.id) === controller) activeCalls.delete(message.id);
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
      const rawLine = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (Buffer.byteLength(rawLine, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
        write(rpcError(null, -32700, 'MCP message exceeds the 8 MB limit.'));
        continue;
      }
      const line = rawLine.trim();
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
    if (Buffer.byteLength(buffer, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
      buffer = '';
      write(rpcError(null, -32700, 'MCP message exceeds the 8 MB limit.'));
    }
  });
}

import { errorPayload, ToolKnitError } from './errors.mjs';
import { executeTool, listTools } from './tool-registry.mjs';
import { AGENT_INSTRUCTIONS } from './agent-instructions.mjs';

const SERVER_INFO = Object.freeze({ name: 'toolknit', version: '3.2.0' });
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
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
  let discardingOversizedLine = false;
  let closed = false;
  const activeCalls = new Map();

  const close = () => {
    if (closed) return;
    closed = true; buffer = '';
    for (const controller of activeCalls.values()) controller.abort('MCP connection closed.');
  };
  const write = message => {
    if (closed || output.destroyed || output.writableEnded) return;
    // A disconnected/stalled IDE must not cause unbounded response buffering.
    if (output.writableLength > 16 * 1024 * 1024) { close(); return; }
    try {
      let serialized = JSON.stringify(message);
      if (Buffer.byteLength(serialized) > MAX_MCP_MESSAGE_BYTES) {
        if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
        serialized = JSON.stringify(response(message.id, toolErrorResult(new ToolKnitError('PROCESSING_FAILED', 'Result exceeds the 8 MiB MCP response limit. Narrow the request or use explicit file output.'))));
      }
      output.write(`${serialized}\n`);
    } catch { close(); }
  };
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
    if (message.params !== undefined && (!message.params || typeof message.params !== 'object' || Array.isArray(message.params))) {
      if (hasId) write(rpcError(message.id, -32602, 'params must be an object.'));
      return;
    }
    try {
      if (message.method === 'initialize') {
        if (!hasId) return;
        if (typeof message.params?.protocolVersion !== 'string') { write(rpcError(message.id, -32602, 'protocolVersion is required.')); return; }
        const requested = message.params?.protocolVersion;
        initialized = true;
        if (hasId) {
          write(response(message.id, {
            protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: AGENT_INSTRUCTIONS
          }));
        }
        return;
      }
      if (message.method === 'notifications/initialized') return;
      if (message.method === 'notifications/cancelled') {
        const requestId = message.params?.requestId;
        const controller = activeCalls.get(requestId);
        if (controller && !controller.signal.aborted) {
          controller.abort('MCP request cancelled.');
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
        if (message.params?.cursor !== undefined) { if (hasId) write(rpcError(message.id, -32602, 'This catalog is returned in one page; cursors are not supported.')); return; }
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
        if (typeof name !== 'string' || !name || progressToken !== undefined && typeof progressToken !== 'string' && typeof progressToken !== 'number') {
          write(rpcError(message.id, -32602, 'A tool name and a string or number progress token are required.')); return;
        }
        const controller = new AbortController();
        activeCalls.set(message.id, controller);
        let previousProgress = 0;
        const reportProgress = (progress, messageText) => {
          if (progressToken === undefined) return;
          if (!Number.isFinite(progress)) return;
          previousProgress = Math.max(previousProgress, Math.min(100, Math.max(0, progress)));
          write({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: { progressToken, progress: previousProgress, total: 100, message: String(messageText || '').slice(0, 300) }
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
    if (closed) return;
    if (discardingOversizedLine) {
      const newline = chunk.indexOf('\n');
      if (newline < 0) return;
      chunk = chunk.slice(newline + 1); discardingOversizedLine = false;
    }
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
      discardingOversizedLine = true;
      write(rpcError(null, -32700, 'MCP message exceeds the 8 MB limit.'));
    }
  });
  input.on('end', close);
  input.on('error', close);
  output.on('error', close);
  return { close };
}

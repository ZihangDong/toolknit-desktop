import { listTools, executeTool } from './tool-registry.mjs';
import { EXTENDED_OPERATIONS } from './extended-tools.mjs';
import { DESKTOP_COVERAGE } from './desktop-coverage.mjs';
import { readInputFile } from './safe-files.mjs';
import { ToolKnitError, throwIfAborted } from './errors.mjs';

const MAX_ARGUMENT_BYTES = 8 * 1024 * 1024;
const usage = message => new ToolKnitError('USAGE', message);
const catalogHelp = 'toolknit tools list [--json]\ntoolknit tools coverage [--json]\ntoolknit tools describe <toolknit_name> [--json]\ntoolknit run <toolknit_name> --arguments-file <request.json> [--json]\ntoolknit run <toolknit_name> --arguments-stdin [--json]';
export function extendedHelp() {
  return '\nV3.2 tools (also available through MCP):\n' + EXTENDED_OPERATIONS.map(item => `  toolknit ${item.command.join(' ')} --help`).join('\n') + '\n\n' + catalogHelp;
}
function decodeJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw usage('Arguments must be a valid UTF-8 JSON object.'); }
}
async function stdinBytes(signal) {
  throwIfAborted(signal);
  if (process.stdin.isTTY) throw usage('Pipe the input to stdin; interactive secret entry is not supported.');
  const chunks = []; let size = 0;
  const abort = () => process.stdin.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of process.stdin) {
      throwIfAborted(signal);
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > MAX_ARGUMENT_BYTES) throw usage('Standard input exceeds 8 MiB.');
      chunks.push(bytes);
    }
    throwIfAborted(signal); return Buffer.concat(chunks);
  } finally { signal?.removeEventListener('abort', abort); }
}
function commandHelp(operation) {
  const definition = operation.definition;
  return [`toolknit ${operation.command.join(' ')} [options]`, '', definition.description, '',
    ...Object.entries(definition.inputSchema.properties).map(([name, rule]) => {
      const required = definition.inputSchema.required?.includes(name) ? ' (required)' : '';
      const type = rule.enum ? rule.enum.join('|') : rule.type || 'JSON';
      return `  --${name.replaceAll('_', '-')} <${type}>${required}${rule.description ? ': ' + rule.description : ''}`;
    }), '', 'Use --arguments-file request.json or --arguments-stdin for structured parameters.',
    'For text tools, --stdin reads UTF-8 text. --json returns structured output.',
    'Existing inputs are never replaced; writes require an explicit destination.'].join('\n');
}
function fieldFor(token, properties) {
  const alias = { input: properties.input_paths ? 'input_paths' : 'input_path', output: 'output_path', format: properties.target_format ? 'target_format' : 'format' };
  return alias[token] || token.replaceAll('-', '_');
}
function valueFor(value, schema) {
  const type = schema.type || (schema.enum && typeof schema.enum[0]);
  if (type === 'number' || type === 'integer') {
    if (!value.trim() || !Number.isFinite(Number(value))) throw usage('Expected a finite numeric option.');
    return Number(value);
  }
  if (type === 'boolean') {
    if (!['true', 'false'].includes(value)) throw usage('Boolean options accept true or false.');
    return value === 'true';
  }
  if (type === 'object' || type === 'array') return decodeJson(Buffer.from(value));
  return value;
}
async function argumentsFor(tokens, definition, signal) {
  const args = {}, properties = definition.inputSchema.properties;
  let argumentFile, argumentStdin = false, textStdin = false;
  const seen = new Set();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw usage('Unexpected positional argument.');
    if (token === '--json') continue;
    if (token === '--banner') {
      if (!['auto', 'always', 'never'].includes(tokens[++index])) throw usage('banner must be auto, always or never.');
      continue;
    }
    if (token === '--arguments-stdin' || token === '--stdin') {
      if (seen.has(token)) throw usage('Duplicate input option.');
      seen.add(token);
      if (token === '--stdin') textStdin = true; else argumentStdin = true;
      continue;
    }
    if (token === '--arguments-file') {
      if (argumentFile !== undefined || !tokens[index + 1] || tokens[index + 1].startsWith('--')) throw usage('Supply one arguments file.');
      argumentFile = tokens[++index]; continue;
    }
    const name = fieldFor(token.slice(2), properties), rule = properties[name];
    if (!rule) throw usage('Unknown option. See the command help or tools describe.');
    if (/password|api_key|token|secret/i.test(name)) throw usage('Secrets must use arguments-stdin; never command-line options.');
    const repeated = rule.type === 'array' && rule.items?.type === 'string';
    if (Object.hasOwn(args, name) && !repeated) throw usage('Duplicate option.');
    if (rule.type === 'boolean' && (!tokens[index + 1] || tokens[index + 1].startsWith('--'))) { args[name] = true; continue; }
    if (tokens[index + 1] === undefined) throw usage('Missing option value.');
    const value = tokens[++index];
    if (repeated) (args[name] ||= []).push(value);
    else if (name === 'pages' && !value.startsWith('[')) {
      const pages = [];
      for (const part of value.split(',')) {
        if (!/^\d+(?:-\d+)?$/.test(part)) throw usage('Pages must be numbers or inclusive ranges.');
        const [start, end = start] = part.split('-').map(Number);
        if (start < 1 || end < start || end > 10000 || pages.length + end - start + 1 > 10000) throw usage('Page range exceeds limits.');
        for (let page = start; page <= end; page++) pages.push(page);
      }
      args[name] = pages;
    } else args[name] = valueFor(value, rule);
  }
  if (Number(argumentFile !== undefined) + Number(argumentStdin) + Number(textStdin) > 1) throw usage('Choose one stdin or arguments-file source.');
  if (argumentFile !== undefined || argumentStdin) {
    if (Object.keys(args).length) throw usage('Arguments JSON cannot be combined with individual parameters.');
    const bytes = argumentStdin ? await stdinBytes(signal) : (await readInputFile(argumentFile, { maxBytes: MAX_ARGUMENT_BYTES, signal })).bytes;
    const parsed = decodeJson(bytes);
    if (!argumentStdin && parsed && Object.hasOwn(parsed, 'password')) throw usage('Passwords must use arguments-stdin, not an arguments file.');
    return parsed;
  }
  if (textStdin) {
    if (!properties.text || args.text !== undefined || args.input_path !== undefined) throw usage('--stdin requires a text tool and cannot be combined with another text source.');
    try { args.text = new TextDecoder('utf-8', { fatal: true }).decode(await stdinBytes(signal)); }
    catch (error) { if (error instanceof ToolKnitError) throw error; throw usage('stdin must contain valid UTF-8 text.'); }
  }
  return args;
}

export async function dispatchCatalogCli(argv, { run }) {
  if (argv[0] === 'tools') {
    const [action, name, ...remaining] = argv.slice(1);
    if (!action || action === '--help') { process.stdout.write(catalogHelp + '\n'); return true; }
    if (action === 'list' && (!name || name === '--json') && !remaining.length) {
      process.stdout.write(JSON.stringify({ ok: true, tools: listTools() }) + '\n'); return true;
    }
    if (action === 'coverage' && (!name || name === '--json') && !remaining.length) {
      process.stdout.write(JSON.stringify({ ok: true, desktop_tools: DESKTOP_COVERAGE.length, mcp_tools: listTools().length, coverage: DESKTOP_COVERAGE }) + '\n'); return true;
    }
    if (action === 'describe' && name && remaining.every(option => option === '--json')) {
      const definition = listTools().find(item => item.name === name);
      if (!definition) throw usage('Unknown tool name.');
      process.stdout.write(JSON.stringify({ ok: true, tool: definition }) + '\n'); return true;
    }
    throw usage(catalogHelp);
  }
  const helpArgs = argv[0] === 'help' ? argv.slice(1) : argv;
  if (EXTENDED_OPERATIONS.some(item => item.command[0] === helpArgs[0]) && (helpArgs.length === 1 || helpArgs.length === 2 && helpArgs[1] === '--help')) {
    const group = helpArgs[0], extra = group === 'image' ? ['toolknit_color_extract'] : [];
    const groupNames = new Set(EXTENDED_OPERATIONS.filter(item => item.command[0] === group).map(item => item.definition.name));
    const definitions = listTools().filter(item => groupNames.has(item.name) || item.name.startsWith(`toolknit_${group}_`) || extra.includes(item.name));
    const lines = definitions.map(definition => {
      const known = EXTENDED_OPERATIONS.find(item => item.definition.name === definition.name);
      const command = known?.command.join(' ') || (definition.name === 'toolknit_color_extract' ? 'image colors' : `${group} ${definition.name.slice(`toolknit_${group}_`.length).replaceAll('_', '-')}`);
      return `  toolknit ${command} --help\n    ${definition.description}`;
    });
    const title = { pdf: 'PDF 工具', image: '图像工具', text: '文本工具' }[group] || group;
    process.stdout.write(`ToolKnit ${title}\n\ntoolknit ${group} <工具> --help\n\n${lines.join('\n')}\n\n${catalogHelp}\n`); return true;
  }
  const operation = EXTENDED_OPERATIONS.find(item => item.command.every((word, index) => word === helpArgs[index]));
  const generic = argv[0] === 'run';
  if (!operation && !generic) return false;
  if (operation && (argv[0] === 'help' || argv.includes('--help'))) { process.stdout.write(commandHelp(operation) + '\n'); return true; }
  if (generic && (!argv[1] || argv[1] === '--help')) { process.stdout.write(catalogHelp + '\n'); return true; }
  const definition = generic ? listTools().find(item => item.name === argv[1]) : operation.definition;
  if (!definition) throw usage('Unknown tool name. Use toolknit tools list.');
  const tokens = argv.slice(generic ? 2 : operation.command.length);
  const result = await run(definition.name, { json: argv.includes('--json') }, async options => {
    const args = await argumentsFor(tokens, definition, options.signal);
    return executeTool(definition.name, args, options);
  });
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  return true;
}

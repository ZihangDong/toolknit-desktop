export const textSource = { text: { type: 'string', maxLength: 1048576 }, input_path: { type: 'string', minLength: 1 } };
export const oneTextSource = { oneOf: [{ required: ['text'] }, { required: ['input_path'] }] };
export const outputPath = { type: 'string', minLength: 1, description: 'Explicit destination. Sources are preserved; existing outputs require overwrite=true.' };
export const overwrite = { type: 'boolean', default: false };
export const inputPath = { type: 'string', minLength: 1, description: 'Explicit regular local file; no symlinks or junctions.' };
export const number = (minimum, maximum, extra = {}) => ({ type: 'number', minimum, maximum, ...extra });
export const integer = (minimum, maximum, extra = {}) => ({ type: 'integer', minimum, maximum, ...extra });
export const choice = values => ({ enum: values });
export const schema = (properties, required = [], extra = {}) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}), ...extra });
export function operation(name, command, description, inputSchema, module, handler, { readOnly = true, network = false } = {}) {
  return { command, module, handler, definition: { name: `toolknit_${name}`, description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: network } } };
}

import Ajv from 'ajv';
import { ToolKnitError } from './errors.mjs';

const ajv = new Ajv({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false, validateFormats: false });
const validators = new WeakMap();

export function validateToolArguments(definition, args) {
  let validate = validators.get(definition);
  if (!validate) { validate = ajv.compile(definition.inputSchema); validators.set(definition, validate); }
  if (!validate(args)) {
    const issue = validate.errors?.[0];
    const operationIndex = /^\/operations\/(\d+)(?:\/|$)/.exec(issue?.instancePath || '');
    // Never echo input values, secret fields, provider messages or JSON snippets.
    throw new ToolKnitError('INVALID_ARGUMENT', 'Arguments do not match the tool schema. Use tools describe to inspect required fields and limits.',
      { details: { rule: issue?.keyword || 'schema', ...(operationIndex ? { operationIndex: Number(operationIndex[1]) } : {}) } });
  }
}

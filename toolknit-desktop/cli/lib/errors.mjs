export const EXIT_CODES = Object.freeze({
  OK: 0,
  USAGE: 2,
  INPUT: 3,
  OUTPUT: 4,
  ENGINE: 5,
  PROCESSING: 6,
  INTERNAL: 70
});

const EXIT_CODE_BY_ERROR = Object.freeze({
  USAGE: EXIT_CODES.USAGE,
  INVALID_ARGUMENT: EXIT_CODES.USAGE,
  INPUT_NOT_FOUND: EXIT_CODES.INPUT,
  INPUT_INVALID: EXIT_CODES.INPUT,
  INPUT_TOO_LARGE: EXIT_CODES.INPUT,
  PDF_PASSWORD_PROTECTED: EXIT_CODES.INPUT,
  OUTPUT_INVALID: EXIT_CODES.OUTPUT,
  OUTPUT_EXISTS: EXIT_CODES.OUTPUT,
  OUTPUT_WRITE_FAILED: EXIT_CODES.OUTPUT,
  ENGINE_UNAVAILABLE: EXIT_CODES.ENGINE,
  PROVIDER_TIMEOUT: EXIT_CODES.PROCESSING,
  PROVIDER_ERROR: EXIT_CODES.PROCESSING,
  AI_CONTENT_UNVERIFIED: EXIT_CODES.PROCESSING,
  AI_LAYOUT_INVALID: EXIT_CODES.PROCESSING,
  PROCESSING_FAILED: EXIT_CODES.PROCESSING
});

export class ToolKnitError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ToolKnitError';
    this.code = code;
    this.exitCode = options.exitCode ?? EXIT_CODE_BY_ERROR[code] ?? EXIT_CODES.INTERNAL;
    this.details = options.details;
  }
}

export function toToolKnitError(error) {
  if (error instanceof ToolKnitError) return error;

  const details = String(error?.message || error || 'Unknown error');
  const normalized = details.toLowerCase();
  if (normalized.includes('password') || normalized.includes('encrypted')) {
    return new ToolKnitError('PDF_PASSWORD_PROTECTED', 'The PDF is password-protected. Decrypt it before this operation.');
  }
  return new ToolKnitError('PROCESSING_FAILED', 'ToolKnit could not process this file.');
}

export function errorPayload(error) {
  const normalized = toToolKnitError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details })
    }
  };
}

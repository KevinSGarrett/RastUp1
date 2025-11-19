export class DocsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DocsError';
    this.code = code;
    this.details = details;
  }
}

export function assertDocs(condition, code, message, details = {}) {
  if (!condition) {
    throw new DocsError(code, message, details);
  }
}

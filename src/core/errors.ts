// instanceof breaks across duplicated modules (one ESM copy, one CJS copy), so identify errors by a global Symbol marker.
const OCTEN_ERROR_MARK = Symbol.for('octen.error');

// Literal names: consumers' bundlers rename classes when minifying, so new.target.name is unreliable.
function setName(cls: { prototype: Error }, name: string): void {
  Object.defineProperty(cls.prototype, 'name', { value: name, writable: true, configurable: true });
}

export class OctenError extends Error {
  static {
    setName(this, 'OctenError');
  }

  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
Object.defineProperty(OctenError.prototype, OCTEN_ERROR_MARK, { value: true });

export function isOctenError(x: unknown): x is OctenError {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[OCTEN_ERROR_MARK] === true;
}

export type APIErrorInit = {
  status: number;
  code: number | null;
  message: string;
  requestId: string | null;
  body: unknown;
};

export class OctenAPIError extends OctenError {
  static {
    setName(this, 'OctenAPIError');
  }

  readonly status: number;
  readonly code: number | null;
  readonly requestId: string | null;
  readonly body: unknown;

  constructor(init: APIErrorInit) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.body = init.body;
  }
}

export class OctenAuthenticationError extends OctenAPIError {
  static {
    setName(this, 'OctenAuthenticationError');
  }
}
export class OctenPermissionDeniedError extends OctenAPIError {
  static {
    setName(this, 'OctenPermissionDeniedError');
  }
}
export class OctenBadRequestError extends OctenAPIError {
  static {
    setName(this, 'OctenBadRequestError');
  }
}
export class OctenServerError extends OctenAPIError {
  static {
    setName(this, 'OctenServerError');
  }
}

export class OctenRateLimitError extends OctenAPIError {
  static {
    setName(this, 'OctenRateLimitError');
  }

  // Seconds; null when the response has no Retry-After or it cannot be parsed.
  readonly retryAfter: number | null;

  constructor(init: APIErrorInit & { retryAfter: number | null }) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

export class OctenTimeoutError extends OctenError {
  static {
    setName(this, 'OctenTimeoutError');
  }

  constructor(message = 'Request timed out.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenConnectionError extends OctenError {
  static {
    setName(this, 'OctenConnectionError');
  }

  constructor(message = 'Connection error.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenAbortError extends OctenError {
  static {
    setName(this, 'OctenAbortError');
  }

  constructor(message = 'Request was aborted.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenValidationError extends OctenError {
  static {
    setName(this, 'OctenValidationError');
  }

  readonly field: string;

  constructor(field: string, message?: string) {
    super(message ?? `Invalid value for "${field}".`);
    this.field = field;
  }
}

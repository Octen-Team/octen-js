// 跨模块副本（ESM 与 CJS 各一份）时 instanceof 会失效，所以用全局 Symbol 标记来判断。
const OCTEN_ERROR_MARK = Symbol.for('octen.error');

export class OctenError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
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

export class OctenAuthenticationError extends OctenAPIError {}
export class OctenPermissionDeniedError extends OctenAPIError {}
export class OctenBadRequestError extends OctenAPIError {}
export class OctenServerError extends OctenAPIError {}

export class OctenRateLimitError extends OctenAPIError {
  // 单位秒；响应没有（或无法解析）Retry-After 时为 null。
  readonly retryAfter: number | null;

  constructor(init: APIErrorInit & { retryAfter: number | null }) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

export class OctenTimeoutError extends OctenError {
  constructor(message = 'Request timed out.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenConnectionError extends OctenError {
  constructor(message = 'Connection error.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenAbortError extends OctenError {
  constructor(message = 'Request was aborted.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OctenValidationError extends OctenError {
  readonly field: string;

  constructor(field: string, message?: string) {
    super(message ?? `Invalid value for "${field}".`);
    this.field = field;
  }
}

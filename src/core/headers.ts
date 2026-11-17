import { OctenValidationError } from './errors';

/** 逐项交给 Headers 校验（名称与值的字符集以运行时为准），失败统一抛 OctenValidationError(field)。 */
export function assertValidHeaders(headers: Record<string, string> | undefined, field: string): void {
  if (headers === undefined) return;
  if (typeof headers !== 'object' || headers === null) {
    throw new OctenValidationError(field, `${field} must be an object of string values.`);
  }
  const probe = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new OctenValidationError(field, `Header "${name}" must have a string value.`);
    }
    try {
      probe.set(name, value);
    } catch {
      throw new OctenValidationError(field, `Header "${name}" has an invalid name or value.`);
    }
  }
}

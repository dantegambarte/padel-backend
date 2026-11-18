/**
 * Shared redaction for logs and error reports: masks secrets and personal data
 * (passwords, tokens, cookies, phone numbers, emails) by key and by pattern.
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /password|passwd|authorization|cookie|token|secret|apikey|phone|email|dsn/;

const STRING_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[\w.~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
  [/\b(refresh_token|access_token|accessToken|refreshToken|token)=[^;\s&]+/g, `$1=${REDACTED}`],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, REDACTED],
  // 9-15 digits, optionally separated by spaces, dots, dashes or parentheses.
  [/(?<![\w-])\+?\d(?:[\s().-]?\d){8,14}(?![\w-])/g, REDACTED],
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z]/g, ''));
}

export function redactString(value: string): string {
  return STRING_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    value,
  );
}

/** Returns a redacted deep copy; the input is never mutated. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    copy.stack = value.stack === undefined ? undefined : redactString(value.stack);
    return copy;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(item, seen);
  }
  return out;
}

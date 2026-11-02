/** Every error code the gateway can return (HTTP-03). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

/** The only error body shape (HTTP-02). */
export function errorBody(code: ErrorCode): { error: { code: ErrorCode } } {
  return { error: { code } };
}

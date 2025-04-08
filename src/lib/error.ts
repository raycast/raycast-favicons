export type ErrorType =
  | "missing_url"
  | "invalid_url"
  | "invalid_size"
  | "invalid_dpr"
  | "internal";

export class APIError extends Error {
  status: number;
  code: string;
  message: string;

  constructor(status: number, code: ErrorType, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
  }
}

export function makeInternalError() {
  return new APIError(500, "internal", "Internal error");
}

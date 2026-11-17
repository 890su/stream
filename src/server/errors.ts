// HttpError: an error with an HTTP status, turned into a JSON response by http.ts.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status} ${message}`);
    this.status = status;
  }
}

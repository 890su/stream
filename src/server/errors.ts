export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status} ${message}`);
    this.status = status;
  }
}

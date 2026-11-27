/** A failure with the HTTP status the API should answer with. */
export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

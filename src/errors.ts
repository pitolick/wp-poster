export class WPPosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WPPosterError';
  }
}

export class WPRequestError extends WPPosterError {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'WPRequestError';
    this.status = status;
    this.body = body;
  }
}

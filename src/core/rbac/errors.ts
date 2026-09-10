/** Thrown by `assertCan` and by service-level guards. Mapped to HTTP 403. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Mapped to HTTP 401 - no valid session at all. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Sign in to continue.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Mapped to HTTP 404. Used when a record exists but is out of the caller's scope too. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Mapped to HTTP 422 - the request was understood but violates a domain rule. */
export class DomainError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Mapped to HTTP 400 - malformed input. */
export class ValidationError extends Error {
  readonly status = 400;
  readonly issues: Record<string, string[]>;
  constructor(message: string, issues: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

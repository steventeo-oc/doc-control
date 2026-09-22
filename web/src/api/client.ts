export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string>,
    /** Seconds from a Retry-After header (429 and 503), when the server sent one. */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

function retryAfterSeconds(res: Response): number | undefined {
  const seconds = Number(res.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// All API calls go through the /api mount (server.servlet.context-path).
const BASE = '/api';

// CSRF double-submit: the backend sets the XSRF-TOKEN cookie (readable by
// JS); mutating requests echo it in the X-XSRF-TOKEN header.
function csrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const token = csrfTokenFromCookie();
    if (token) {
      headers.set('X-XSRF-TOKEN', token);
    }
  }
  const res = await fetch(BASE + path, { credentials: 'include', ...init, headers });
  if (res.status === 204) {
    return undefined as T;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Errors follow RFC 9457 ProblemDetail from the backend; the assistant
    // service (FastAPI) also puts a sentence in `detail`, except for its
    // validation errors, where it is a list, so only a string is used.
    const detail = typeof body?.detail === 'string' ? body.detail : undefined;
    throw new ApiError(res.status, detail ?? res.statusText, body?.errors, retryAfterSeconds(res));
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};

/** Triggers a file download (the backend sets Content-Disposition). */
export function downloadFile(path: string): void {
  const anchor = document.createElement('a');
  anchor.href = BASE + path;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

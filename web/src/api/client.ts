export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string>,
  ) {
    super(message);
  }
}

// All API calls go through the /api mount (server.servlet.context-path).
const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { credentials: 'include', ...init });
  if (res.status === 204) {
    return undefined as T;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Errors follow RFC 9457 ProblemDetail from the backend
    throw new ApiError(res.status, body?.detail ?? res.statusText, body?.errors);
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

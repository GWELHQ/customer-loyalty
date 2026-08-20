export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  onUnauthorized?: () => void;
  /**
   * Called on a 401 to try to obtain a fresh access token (e.g. via the
   * refresh token) before giving up. Returning a token retries the
   * original request once with it; returning null/rejecting falls through
   * to `onUnauthorized`. Never called for the refresh endpoint itself.
   */
  refreshAccessToken?: () => Promise<string | null>;
  /** Override the transport (e.g. an in-memory demo-mode handler). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const REFRESH_PATH = '/auth/refresh';

/** Thin fetch wrapper. Every typed resource method in this package goes through this. */
export class HttpClient {
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  private rawFetch(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    init: { isFormData?: boolean } | undefined,
    token: string | null | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!init?.isFormData && body !== undefined) headers['Content-Type'] = 'application/json';

    const doFetch = this.options.fetchImpl ?? fetch;
    return doFetch(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      body: init?.isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private getRefreshedToken(): Promise<string | null> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = (this.options.refreshAccessToken?.() ?? Promise.resolve(null)).finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    init?: { isFormData?: boolean },
  ): Promise<T> {
    let res = await this.rawFetch(method, path, body, init, this.options.getAccessToken?.());

    if (res.status === 401 && path !== REFRESH_PATH && this.options.refreshAccessToken) {
      const newToken = await this.getRefreshedToken();
      if (newToken) {
        res = await this.rawFetch(method, path, body, init, newToken);
      }
    }

    if (res.status === 401) {
      this.options.onUnauthorized?.();
    }

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const message =
        typeof payload === 'object' && payload && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : `Request failed with status ${res.status}`;
      throw new ApiError(res.status, payload, message);
    }

    return payload as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown, init?: { isFormData?: boolean }): Promise<T> {
    return this.request<T>('POST', path, body, init);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}

export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

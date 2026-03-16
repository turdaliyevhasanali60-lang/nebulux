/**
 * Nebulux — core/api.js
 * ─────────────────────────────────────────────────────────
 * Centralised HTTP client.
 *
 * Design decisions
 * ────────────────
 * • Wraps Auth.authFetch — which already owns the full JWT lifecycle
 *   (token attachment, silent refresh, 401 retry).  Re-implementing
 *   that with Axios interceptors would duplicate complex, battle-tested
 *   logic for no gain.
 * • Public helpers: get / post / put / patch / del
 *   All return parsed JSON or throw an ApiError with .status and .data.
 * • A separate `publicFetch` helper exists for unauthenticated calls
 *   (e.g. auth/register, auth/login) that must NOT attach a Bearer token.
 * • All API paths are resolved relative to BASE so callers never repeat
 *   the /api prefix.
 *
 * Usage examples
 * ──────────────
 *   const projects = await API.get('/websites/');
 *   const result   = await API.post('/payments/create-checkout/', { product: 'standard_monthly' });
 *   await API.del('/websites/42/');
 * ─────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ── base URL ──────────────────────────────────────────── */
  const _base = (() => {
    const override = new URLSearchParams(window.location.search).get('api');
    if (override) return override.replace(/\/$/, '');
    if (window.location.port === '5500' || window.location.port === '5501') {
      return 'http://127.0.0.1:8000/api';
    }
    return '/api';
  })();

  /* ── ApiError ──────────────────────────────────────────── */
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name    = 'ApiError';
      this.status  = status;
      this.data    = data;
    }
  }

  /**
   * Extract the most human-friendly error string from a Django REST
   * error response payload.
   */
  function _extractMessage(data, status) {
    if (!data) {
      if (status === 429) return 'Too many requests. Please wait and try again.';
      if (status >= 500) return 'Server error. Please try again in a moment.';
      return `Request failed (HTTP ${status}).`;
    }
    if (typeof data.error   === 'string') return data.error;
    if (typeof data.detail  === 'string') return data.detail;
    if (typeof data.message === 'string') return data.message;
    // DRF field-level errors — flatten to first message
    const values = Object.values(data);
    if (values.length) {
      const first = values[0];
      return Array.isArray(first) ? first[0] : String(first);
    }
    return `Request failed (HTTP ${status}).`;
  }

  /* ── Authenticated request core ────────────────────────── */
  async function _request(method, path, body = null, opts = {}) {
    const url = `${_base}${path}`;

    // authFetch is the source of truth for JWT attachment + refresh retry.
    // It must exist on window.Auth by the time any page JS calls API.*.
    const fetcher = (window.Auth && typeof Auth.authFetch === 'function')
      ? Auth.authFetch.bind(Auth)
      : fetch;   // fallback for pages where Auth hasn't loaded yet (unlikely)

    const fetchOpts = {
      method: method.toUpperCase(),
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    };

    if (body !== null) {
      fetchOpts.body = (typeof body === 'string') ? body : JSON.stringify(body);
    }

    let res;
    try {
      res = await fetcher(url, fetchOpts);
    } catch (networkErr) {
      throw new ApiError(
        'Network error — check your connection and try again.',
        0,
        null,
      );
    }

    // Parse JSON — tolerate empty bodies (204 No Content, etc.)
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    }

    if (!res.ok) {
      throw new ApiError(_extractMessage(data, res.status), res.status, data);
    }

    return data;
  }

  /* ── Unauthenticated fetch (used by auth flows) ────────── */
  async function _publicRequest(method, path, body = null) {
    const url = `${_base}${path}`;
    const fetchOpts = {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== null) fetchOpts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(url, fetchOpts);
    } catch {
      throw new ApiError('Network error — check your connection.', 0, null);
    }

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json')
      ? await res.json().catch(() => ({}))
      : null;

    if (!res.ok) throw new ApiError(_extractMessage(data, res.status), res.status, data);
    return data;
  }

  /* ── Public surface ────────────────────────────────────── */
  const API = {
    /** GET  /api{path} (authenticated) */
    get:   (path, opts)        => _request('GET',    path, null, opts),

    /** POST /api{path} with JSON body (authenticated) */
    post:  (path, body, opts)  => _request('POST',   path, body, opts),

    /** PUT  /api{path} with JSON body (authenticated) */
    put:   (path, body, opts)  => _request('PUT',    path, body, opts),

    /** PATCH /api{path} with JSON body (authenticated) */
    patch: (path, body, opts)  => _request('PATCH',  path, body, opts),

    /** DELETE /api{path} (authenticated) */
    del:   (path, opts)        => _request('DELETE', path, null, opts),

    /**
     * Unauthenticated request — for login/register/forgot-password endpoints
     * that must NOT carry an existing Bearer token.
     */
    public: {
      post: (path, body) => _publicRequest('POST', path, body),
      get:  (path)       => _publicRequest('GET',  path),
    },

    /** Expose base URL for callers that build their own URL (e.g. SSE streams) */
    base: _base,

    /** Expose the error class for instanceof checks */
    Error: ApiError,
  };

  window.API = API;
})();
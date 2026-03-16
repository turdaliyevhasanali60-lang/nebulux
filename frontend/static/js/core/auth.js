/**
 * Nebulux — auth.js
 * ─────────────────────────────────────────────────────
 * Google sign-in uses the OAuth redirect flow.
 * Token storage:
 *   Access token  → JS memory only  (never localStorage)
 *   Refresh token → localStorage["nbx_rt"]
 * ─────────────────────────────────────────────────────
 */

(() => {
  'use strict';

  const API    = '/api/auth';
  const RT_KEY = 'nbx_rt';
  // Refresh 2 minutes before token expiry.
  const LEAD_MS = 2 * 60_000;
  // Fallback schedule delay when JWT cannot be parsed.
  const FALLBACK_MS = 55 * 60_000;

  const S = {
    access:     null,
    user:       null,
    timer:      null,
    refreshing: null,
  };

  /* ─── JWT helpers ────────────────────────────────── */
  function pay(t) {
    try {
      const seg = t.split('.')[1];
      if (!seg) return null;
      // base64url → base64 with correct padding
      const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      const pad = (4 - b64.length % 4) % 4;
      return JSON.parse(atob(b64 + '='.repeat(pad)));
    } catch { return null; }
  }

  function msTilExp(t) {
    const p = pay(t);
    if (!p?.exp) return 0;
    return p.exp * 1000 - Date.now();
  }

  /* ─── Session ────────────────────────────────────── */
  function storeSession(access, refresh, user) {
    S.access = access;
    S.user   = user;
    if (refresh) localStorage.setItem(RT_KEY, refresh);
    scheduleRefresh();
    syncUI();
    document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: S.user } }));

    const needsOnboarding = user && user.has_onboarded === false;

    try {
      const dest = sessionStorage.getItem('nbx_after_login');
      if (dest) {
        sessionStorage.removeItem('nbx_after_login');
        if (needsOnboarding) {
          // Keep dest for after onboarding
          sessionStorage.setItem('nbx_after_login', dest);
        } else {
          setTimeout(() => { window.location.href = dest; }, 350);
        }
      }
    } catch (_) {}

    // Show onboarding for first-time users
    if (needsOnboarding) {
      setTimeout(() => { closeModal(); setTimeout(_showOnboarding, 400); }, 200);
    }
  }

  function clearSession() {
    S.access = null;
    S.user   = null;
    localStorage.removeItem(RT_KEY);
    clearTimeout(S.timer);
    S.timer = null;

    // Wipe all unscoped legacy keys so the next user who logs in on
    // this browser cannot see the previous user's prompts or project data.
    try {
      localStorage.removeItem('nebulux_project');       // old single-project key
      localStorage.removeItem('nebulux_prompt');        // old unscoped prompt
      localStorage.removeItem('nebulux_attachments');   // old unscoped attachments
    } catch (_) {}

    syncUI();
    document.dispatchEvent(new CustomEvent('auth:logout'));
  }

  function scheduleRefresh() {
    clearTimeout(S.timer);
    if (!S.access) return;
    const ttl = msTilExp(S.access);
    const ms = ttl > LEAD_MS
      ? ttl - LEAD_MS
      : ttl > 10_000
        ? ttl - 5_000
        : FALLBACK_MS;
    S.timer = setTimeout(doRefresh, ms);
  }

  /* ─── Cross-tab sync ───────────────────────────────
     When another tab rotates the refresh token, this tab
     picks it up immediately via the storage event.
     This prevents the classic multi-tab race condition:
       Tab A rotates RT_old → RT_new (blacklists RT_old)
       Tab B still has RT_old → 401 → logged out
     Now: Tab B sees RT_new in localStorage → resets its
     timer → never sends RT_old.
  ──────────────────────────────────────────────────── */
  window.addEventListener('storage', (e) => {
    if (e.key !== RT_KEY) return;

    if (!e.newValue) {
      // Another tab cleared the RT (explicit logout).
      clearSession();
      return;
    }

    if (e.newValue !== e.oldValue) {
      // Another tab rotated the token — reschedule our refresh timer
      // so we don't send the now-blacklisted old token.
      clearTimeout(S.timer);
      // We don't have the new access token (only the other tab does),
      // so silently refresh using the new RT to get our own access token.
      S.timer = setTimeout(async () => {
        const ok = await silentRefresh();
        if (ok) scheduleRefresh();
      }, 2_000);
    }
  });

  /* ─── Token refresh (background) ────────────────── */
  // Only clears session on confirmed 401/403 (token genuinely dead).
  // Transient 5xx errors and network failures retry silently — the user
  // is never logged out due to a server hiccup.
  let _refreshRetries = 0;
  const _MAX_RETRIES  = 5;

  async function doRefresh() {
    // If silentRefresh() is already in-flight (e.g. triggered by an authFetch
    // 401 at the same moment the timer fires), wait for that promise instead
    // of making a second simultaneous refresh call.
    if (S.refreshing) {
      const ok = await S.refreshing;
      if (ok) {
        scheduleRefresh();
      } else if (!localStorage.getItem(RT_KEY) && !S.access) {
        clearSession();
      }
      return;
    }

    const rt = localStorage.getItem(RT_KEY);
    if (!rt) {
      if (!S.access) {
        clearSession();
      } else {
        scheduleRefresh();
      }
      return;
    }
    try {
      const r = await fetch(`${API}/refresh/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh: rt }),
      });

      if (r.status === 401 || r.status === 403) {
        // Before logging out: check if another tab already rotated the token.
        // With ROTATE + BLACKLIST, two tabs can race:
        //   Tab A sends RT_old → server rotates → RT_old blacklisted
        //   Tab B sends RT_old → 401 (blacklisted)
        // But Tab A already saved RT_new to localStorage, so re-read it.
        const currentRt = localStorage.getItem(RT_KEY);
        if (currentRt && currentRt !== rt) {
          // Another tab already rotated — retry with the new token.
          _refreshRetries = 0;
          S.timer = setTimeout(doRefresh, 1000);
          return;
        }
        // Token is genuinely dead and no other tab saved a new one.
        _refreshRetries = 0;
        clearSession();
        return;
      }

      if (!r.ok) {
        _refreshRetries++;
        const backoff = Math.min(60_000 * _refreshRetries, 300_000);
        S.timer = setTimeout(doRefresh, backoff);
        return;
      }

      _refreshRetries = 0;
      const d = await r.json();
      S.access = d.access;
      if (d.refresh) localStorage.setItem(RT_KEY, d.refresh);
      scheduleRefresh();
    } catch {
      _refreshRetries++;
      const backoff = Math.min(30_000 * _refreshRetries, 300_000);
      S.timer = setTimeout(doRefresh, backoff);
    }
  }

  /* ─── Silent refresh (used by restore + authFetch) ─ */
  // Returns true/false. Does NOT call clearSession on failure.
  // Callers decide what to do with a failed refresh.
  async function silentRefresh() {
    const rt = localStorage.getItem(RT_KEY);
    if (!rt) return false;
    if (S.refreshing) return S.refreshing;

    S.refreshing = (async () => {
      try {
        const r = await fetch(`${API}/refresh/`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refresh: rt }),
        });
        if (r.status === 401 || r.status === 403) {
          // Check if another tab already rotated the token while we waited.
          const currentRt = localStorage.getItem(RT_KEY);
          if (currentRt && currentRt !== rt) {
            // Another tab saved a new RT — use it on next attempt.
            return !!S.access;
          }
          return false;
        }
        if (!r.ok) {
          return !!S.access;
        }
        const d = await r.json();
        S.access = d.access;
        if (d.refresh) localStorage.setItem(RT_KEY, d.refresh);
        scheduleRefresh();
        return true;
      } catch {
        return !!S.access;
      } finally {
        S.refreshing = null;
      }
    })();

    return S.refreshing;
  }

  /* ─── authFetch ──────────────────────────────────── */
  async function authFetch(url, opts = {}) {
    if (!S.access) await silentRefresh();
    const go = tok => fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
    });
    let res = await go(S.access);
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok && S.access) res = await go(S.access);
    }
    return res;
  }

  window.authFetch       = authFetch;
  window.getAuthUser     = () => S.user;
  window.isAuthenticated = () => !!S.access;

  /* ─── UI sync ────────────────────────────────────── */
  function cap(s = '') { return s.charAt(0).toUpperCase() + s.slice(1); }

  function syncUI() {
    const u = S.user;
    if (u) {
      const pname = document.querySelector('.dropdown-plan-name');
      if (pname) pname.textContent = cap(u.plan);
      const ptok = document.querySelector('.dropdown-plan-tokens');
      if (ptok) ptok.textContent = `Credits: ${u.credits} / ${u.monthly_credit_limit}`;
      const nm = document.getElementById('accountName');
      const em = document.getElementById('accountEmail');
      if (nm) nm.value = u.name  || '';
      if (em) em.value = u.email || '';
      // Populate the dropdown user name and email display
      const ddName  = document.getElementById('dropdownUserName');
      const ddEmail = document.getElementById('dropdownUserEmail');
      if (ddName)  ddName.textContent  = u.name  || u.email || '—';
      if (ddEmail) ddEmail.textContent = u.email || '';
    }
    document.dispatchEvent(new CustomEvent('auth:change', { detail: { user: u } }));
  }

  /* ════════════════════════════════════════════════════
     STYLES
  ════════════════════════════════════════════════════ */
  const CSS = `
.nb-ov {
  position: fixed; inset: 0; z-index: 9900;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: rgba(8,8,16,0.75);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  opacity: 0; transition: opacity .28s ease;
}
.nb-ov.nb-vis { opacity: 1; }
.nb-ov[hidden] { display: none !important; }
.nb-orb { display: none; }
.nb-card {
  position: relative; z-index: 1;
  width: 100%; max-width: 420px; max-height: 92vh; overflow-y: auto;
  background: #ffffff; border-radius: 20px;
  box-shadow: 0 2px 0 0 rgba(0,0,0,0.04), 0 20px 60px rgba(0,0,0,0.28), 0 4px 16px rgba(0,0,0,0.12);
  transform: translateY(20px) scale(0.97);
  transition: transform .38s cubic-bezier(0.34,1.46,0.64,1);
}
.nb-ov.nb-vis .nb-card { transform: translateY(0) scale(1); }
.nb-card::before {
  content: ''; position: absolute; top: 0; left: 12%; right: 12%; height: 2px;
  background: linear-gradient(90deg, transparent 0%, rgba(245,146,26,0.6) 30%, rgba(245,146,26,1) 50%, rgba(245,146,26,0.6) 70%, transparent 100%);
  border-radius: 20px 20px 0 0; pointer-events: none;
}
.nb-card::-webkit-scrollbar { width: 3px; }
.nb-card::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }
.nb-hd { padding: 32px 32px 0; position: relative; }
.nb-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; text-decoration: none; }
.nb-logo-img { width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
.nb-logo-text { font-family: 'Space Grotesk','Outfit',sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 3px; color: #111827; }
.nb-title { font-family: 'Space Grotesk','Outfit',sans-serif; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.25; color: #111827; margin: 0 0 6px; }
.nb-sub { font-family: 'Outfit',sans-serif; font-size: 14px; color: #6b7280; margin: 0 0 24px; line-height: 1.55; }
.nb-bd { padding: 0 32px 32px; }
.nb-x {
  position: absolute; top: 16px; right: 16px; width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid #e5e7eb; background: #f9fafb; color: #9ca3af;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .15s; line-height: 0; font-family: inherit; z-index: 10;
}
.nb-x:hover { background: #f3f4f6; border-color: #d1d5db; color: #374151; }
.nb-google {
  width: 100%; padding: 11px 18px;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  font-family: 'Outfit',sans-serif; font-size: 14px; font-weight: 600; color: #111827;
  cursor: pointer; margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  transition: background .15s, box-shadow .15s, transform .15s;
}
.nb-google:hover { background: #f9fafb; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transform: translateY(-1px); }
.nb-google:active { transform: translateY(0); box-shadow: none; }
.nb-google:disabled { opacity: .6; cursor: not-allowed; transform: none; }
.nb-divider { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; color: #9ca3af; font-family: 'Outfit',sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; }
.nb-divider::before, .nb-divider::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
.nb-form { display: flex; flex-direction: column; gap: 12px; }
.nb-fld  { display: flex; flex-direction: column; gap: 5px; }
.nb-lbl { font-family: 'Outfit',sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: #6b7280; }
.nb-lbl-opt { color: #9ca3af; font-weight: 400; text-transform: none; letter-spacing: 0; }
.nb-iw { position: relative; }
.nb-inp {
  width: 100%; box-sizing: border-box; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 9px;
  padding: 11px 14px; font-family: 'Outfit',sans-serif; font-size: 14px; color: #111827;
  outline: none; transition: border-color .15s, box-shadow .15s, background .15s;
}
.nb-inp::placeholder { color: #9ca3af; }
.nb-inp:focus { background: #fff; border-color: #111827; box-shadow: 0 0 0 3px rgba(17,24,39,0.07); }
.nb-inp.nb-pr { padding-right: 42px; }
.nb-otp-inp { font-family: 'Space Mono','Courier New',monospace !important; font-size: 26px !important; letter-spacing: 14px !important; text-align: center !important; padding: 14px 12px !important; }
.nb-pw { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #9ca3af; padding: 4px; line-height: 0; transition: color .15s; font-family: inherit; }
.nb-pw:hover { color: #374151; }
.nb-forgot { background: none; border: none; cursor: pointer; padding: 0; font-family: 'Outfit',sans-serif; font-size: 12px; color: #9ca3af; align-self: flex-end; margin-top: -2px; transition: color .15s; }
.nb-forgot:hover { color: #374151; }
.nb-err { background: #fef2f2; border: 1px solid #fecaca; border-left: 3px solid #ef4444; border-radius: 8px; padding: 10px 13px; font-family: 'Outfit',sans-serif; font-size: 13px; line-height: 1.5; color: #dc2626; }
.nb-ok  { background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3px solid #22c55e; border-radius: 8px; padding: 10px 13px; font-family: 'Outfit',sans-serif; font-size: 13px; line-height: 1.5; color: #16a34a; }
.nb-btn { width: 100%; padding: 12px; background: #111827; border: 1px solid #111827; border-radius: 10px; font-family: 'Outfit',sans-serif; font-size: 14px; font-weight: 600; color: #fff; cursor: pointer; letter-spacing: 0.1px; transition: background .15s, transform .15s, box-shadow .15s; }
.nb-btn:hover { background: #1f2937; border-color: #1f2937; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.2); }
.nb-btn:active { transform: translateY(0); box-shadow: none; }
.nb-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; box-shadow: none; }
.nb-link { background: none; border: none; cursor: pointer; padding: 0; font-family: 'Outfit',sans-serif; font-size: 13px; font-weight: 500; color: #374151; transition: color .15s; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: #d1d5db; }
.nb-link:hover { color: #111827; text-decoration-color: #111827; }
.nb-switch { text-align: center; margin-top: 16px; font-family: 'Outfit',sans-serif; font-size: 13px; color: #6b7280; }
.nb-dots { display: flex; justify-content: center; gap: 7px; margin: 10px 0 4px; }
.nb-dot { width: 7px; height: 7px; border-radius: 50%; background: #e5e7eb; border: 1px solid #d1d5db; transition: all .18s; }
.nb-dot.on { background: #111827; border-color: #111827; box-shadow: 0 0 6px rgba(17,24,39,0.25); transform: scale(1.15); }
.nb-rsnd { text-align: center; margin-top: 14px; font-family: 'Outfit',sans-serif; font-size: 13px; color: #6b7280; }
.nb-cd { color: #374151; font-variant-numeric: tabular-nums; }
.nb-sep { height: 1px; margin: 0 0 20px; background: #e5e7eb; }
.nb-panel { display: none; }
.nb-panel.nb-on { display: block; animation: nb-fadein .2s ease; }
@keyframes nb-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
`;

  /* ════════════════════════════════════════════════════
     SVGs / HTML
  ════════════════════════════════════════════════════ */
  const EYE_ON  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const GOOGLE  = `<svg width="17" height="17" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>`;
  const CLOSE   = `<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 1l7 7M8 1l-7 7"/></svg>`;
  const LOGO    = `<div class="nb-logo"><img class="nb-logo-img" src="/static/img/logo.png" alt="Nebulux"><span class="nb-logo-text">NEBULUX</span></div>`;

  function pwField(id, label, ac, req = '') {
    return `<div class="nb-fld"><label class="nb-lbl" for="${id}">${label}</label><div class="nb-iw"><input class="nb-inp nb-pr" type="password" id="${id}" autocomplete="${ac}" placeholder="••••••••" ${req}><button type="button" class="nb-pw" data-for="${id}">${EYE_ON}</button></div></div>`;
  }

  const HTML = `
<div id="nbOv" class="nb-ov" hidden role="dialog" aria-modal="true" aria-labelledby="nbTitle">
  <div class="nb-card">
    <button class="nb-x" id="nbX" aria-label="Close">${CLOSE}</button>

    <div class="nb-panel nb-on" id="nbLogin">
      <div class="nb-hd">${LOGO}<h2 class="nb-title" id="nbTitle">Welcome back</h2><p class="nb-sub">Sign in to your Nebulux account</p></div>
      <div class="nb-bd">
        <button class="nb-google" id="nbGoogL">${GOOGLE} Continue with Google</button>
        <div class="nb-divider"><span>or continue with email</span></div>
        <form class="nb-form" id="nbLF" novalidate>
          <div class="nb-fld"><label class="nb-lbl" for="nbLE">Email address</label><input class="nb-inp" type="email" id="nbLE" autocomplete="email" placeholder="you@example.com" required></div>
          ${pwField('nbLP','Password','current-password','required')}
          <button type="button" class="nb-forgot" id="nbForgotLink">Forgot password?</button>
          <div class="nb-err" id="nbLE2" hidden></div>
          <button type="submit" class="nb-btn" id="nbLBtn">Sign in to Nebulux</button>
        </form>
        <p class="nb-switch">No account? <button class="nb-link" id="nbToReg">Create one free</button></p>
      </div>
    </div>

    <div class="nb-panel" id="nbReg">
      <div class="nb-hd">${LOGO}<h2 class="nb-title">Create account</h2><p class="nb-sub">Start building websites for free</p></div>
      <div class="nb-bd">
        <button class="nb-google" id="nbGoogR">${GOOGLE} Continue with Google</button>
        <div class="nb-divider"><span>or continue with email</span></div>
        <form class="nb-form" id="nbRF" novalidate>
          <div class="nb-fld"><label class="nb-lbl" for="nbRN">Name <span class="nb-lbl-opt">(optional)</span></label><input class="nb-inp" type="text" id="nbRN" autocomplete="name" placeholder="Your name"></div>
          <div class="nb-fld"><label class="nb-lbl" for="nbRE">Email address</label><input class="nb-inp" type="email" id="nbRE" autocomplete="email" placeholder="you@example.com" required></div>
          ${pwField('nbRP','Password','new-password','required')}
          <div class="nb-err" id="nbRE2" hidden></div>
          <button type="submit" class="nb-btn" id="nbRBtn">Create account</button>
        </form>
        <p class="nb-switch">Already have an account? <button class="nb-link" id="nbToLogin">Sign in</button></p>
      </div>
    </div>

    <div class="nb-panel" id="nbOtp">
      <div class="nb-hd">${LOGO}<h2 class="nb-title">Check your inbox</h2><p class="nb-sub">We sent a 6-digit code to<br><span id="nbOtpEmail" style="color:#a29bfe;font-weight:500"></span></p></div>
      <div class="nb-bd">
        <div class="nb-sep"></div>
        <form class="nb-form" id="nbOF" novalidate>
          <div class="nb-fld">
            <label class="nb-lbl" for="nbOI">Verification code</label>
            <input class="nb-inp nb-otp-inp" type="text" id="nbOI" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000">
            <div class="nb-dots" id="nbDots"><div class="nb-dot"></div><div class="nb-dot"></div><div class="nb-dot"></div><div class="nb-dot"></div><div class="nb-dot"></div><div class="nb-dot"></div></div>
          </div>
          <div class="nb-err" id="nbOE" hidden></div>
          <button type="submit" class="nb-btn" id="nbOBtn">Verify code</button>
        </form>
        <div class="nb-rsnd">Didn't receive it? <button class="nb-link" id="nbResend">Resend code</button><span class="nb-cd" id="nbCd" hidden> · <span id="nbCdSecs"></span>s</span></div>
        <p class="nb-switch"><button class="nb-link" id="nbOBack">← Back</button></p>
      </div>
    </div>

    <div class="nb-panel" id="nbFgt">
      <div class="nb-hd">${LOGO}<h2 class="nb-title">Reset password</h2><p class="nb-sub">Enter your email and we'll send a reset link</p></div>
      <div class="nb-bd">
        <form class="nb-form" id="nbFF" novalidate>
          <div class="nb-fld"><label class="nb-lbl" for="nbFE">Email address</label><input class="nb-inp" type="email" id="nbFE" autocomplete="email" placeholder="you@example.com" required></div>
          <div class="nb-err" id="nbFE2" hidden></div>
          <div class="nb-ok"  id="nbFOk" hidden></div>
          <button type="submit" class="nb-btn" id="nbFBtn">Send reset link</button>
        </form>
        <p class="nb-switch"><button class="nb-link" id="nbFBack">← Back to sign in</button></p>
      </div>
    </div>

    <div class="nb-panel" id="nbRst">
      <div class="nb-hd">${LOGO}<h2 class="nb-title">Set new password</h2><p class="nb-sub">Choose a strong password for your account</p></div>
      <div class="nb-bd">
        <form class="nb-form" id="nbStF" novalidate>
          ${pwField('nbStP','New password','new-password','required')}
          <div class="nb-err" id="nbStE" hidden></div>
          <div class="nb-ok"  id="nbStOk" hidden></div>
          <button type="submit" class="nb-btn" id="nbStBtn">Reset password</button>
        </form>
      </div>
    </div>

  </div>
</div>`;

  /* ════════════════════════════════════════════════════
     Panel / modal management
  ════════════════════════════════════════════════════ */
  const PANELS = ['Login','Reg','Otp','Fgt','Rst'];
  function goPanel(n) { PANELS.forEach(p => $(`nb${p}`)?.classList.toggle('nb-on', p === n)); clearMsgs(); }
  function openModal(p = 'Login') {
    const ov = $('nbOv'); ov.removeAttribute('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('nb-vis')));
    document.body.style.overflow = 'hidden'; goPanel(p);
  }
  function closeModal() {
    const ov = $('nbOv'); ov.classList.remove('nb-vis');
    setTimeout(() => ov.setAttribute('hidden',''), 300);
    document.body.style.overflow = '';
  }
  function clearMsgs() { document.querySelectorAll('.nb-err,.nb-ok').forEach(e => { e.hidden = true; e.textContent = ''; }); }
  function showErr(id, msg) { const e = $(id); if (e) { e.textContent = msg; e.hidden = false; } }
  function showOk(id, msg)  { const e = $(id); if (e) { e.textContent = msg; e.hidden = false; } }
  function hideMsg(id)      { const e = $(id); if (e) e.hidden = true; }
  const _saved = {};
  function busy(id, on) {
    const b = $(id); if (!b) return;
    if (on) { _saved[id] = b.textContent; b.textContent = 'Please wait…'; b.disabled = true; }
    else    { b.textContent = _saved[id] || b.textContent; b.disabled = false; }
  }

  /* ════════════════════════════════════════════════════
     API helpers
  ════════════════════════════════════════════════════ */
  async function post(path, body) {
    const r = await fetch(`${API}/${path}/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }
  function flatErr(e, st) {
    if (!e) {
      if (st === 429) return 'Too many attempts. Please wait and try again.';
      if (st >= 500)  return 'Server error. Please try again in a moment.';
      return '';
    }
    if (typeof e === 'string') return e;
    return Object.values(e).map(v => Array.isArray(v) ? v[0] : v).join(' ');
  }

  /* ════════════════════════════════════════════════════
     Auth flows
  ════════════════════════════════════════════════════ */
  let _email = '', _cdTimer = null;

  async function onRegister(e) {
    e.preventDefault(); hideMsg('nbRE2');
    const email = $('nbRE').value.trim(), password = $('nbRP').value, name = $('nbRN').value.trim();
    if (!email || !password) { showErr('nbRE2', !email ? 'Please enter your email address.' : 'Please enter a password.'); return; }
    busy('nbRBtn', true);
    const { ok, status, data } = await post('register', { email, password, name });
    busy('nbRBtn', false);
    if (!ok) { showErr('nbRE2', flatErr(data.error ?? data, status) || 'Registration failed.'); return; }
    _email = email; $('nbOtpEmail').textContent = email; goPanel('Otp'); startCd();
  }

  async function onLogin(e) {
    e.preventDefault(); hideMsg('nbLE2');
    const email = $('nbLE').value.trim(), password = $('nbLP').value;
    if (!email || !password) { showErr('nbLE2', !email ? 'Please enter your email address.' : 'Please enter your password.'); return; }
    busy('nbLBtn', true);
    const { ok, status, data } = await post('login', { email, password });
    busy('nbLBtn', false);
    if (!ok) {
      if (data.requires_verification) { _email = data.email || email; $('nbOtpEmail').textContent = _email; goPanel('Otp'); startCd(); return; }
      showErr('nbLE2', flatErr(data.error, status) || 'Invalid email or password.'); return;
    }
    storeSession(data.access, data.refresh, data.user); closeModal();
  }

  async function onOtp(e) {
    e.preventDefault(); hideMsg('nbOE'); busy('nbOBtn', true);
    const { ok, status, data } = await post('verify-otp', { email: _email, otp: $('nbOI').value.trim() });
    busy('nbOBtn', false);
    if (!ok) { showErr('nbOE', flatErr(data.error, status) || 'Incorrect code. Please try again.'); return; }
    storeSession(data.access, data.refresh, data.user); closeModal();
  }

  async function onResend() {
    hideMsg('nbOE');
    const { ok, status, data } = await post('resend-otp', { email: _email });
    if (!ok) { showErr('nbOE', flatErr(data.error, status) || 'Could not resend.'); return; }
    startCd();
  }

  function syncDots(v) { document.querySelectorAll('.nb-dot').forEach((d, i) => d.classList.toggle('on', i < v.length)); }

  function startCd(s = 60) {
    const btn = $('nbResend'), wrap = $('nbCd'), num = $('nbCdSecs');
    if (btn) btn.disabled = true; if (wrap) wrap.hidden = false;
    let rem = s; if (num) num.textContent = rem; clearInterval(_cdTimer);
    _cdTimer = setInterval(() => { rem--; if (num) num.textContent = rem; if (rem <= 0) { clearInterval(_cdTimer); if (btn) btn.disabled = false; if (wrap) wrap.hidden = true; } }, 1000);
  }

  async function onForgot(e) {
    e.preventDefault(); hideMsg('nbFE2'); hideMsg('nbFOk'); busy('nbFBtn', true);
    const { ok, status, data } = await post('forgot-password', { email: $('nbFE').value.trim() });
    busy('nbFBtn', false);
    if (!ok) { showErr('nbFE2', flatErr(data.error, status) || 'Could not send reset link.'); return; }
    showOk('nbFOk', data.message || 'If that email is registered, a reset link has been sent.');
  }

  async function onReset(e) {
    e.preventDefault(); hideMsg('nbStE');
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) { showErr('nbStE', 'Reset token missing. Please use the link in your email.'); return; }
    busy('nbStBtn', true);
    const { ok, status, data } = await post('reset-password', { token, password: $('nbStP').value });
    busy('nbStBtn', false);
    if (!ok) { showErr('nbStE', flatErr(data.error, status) || 'Link expired. Please request a new one.'); return; }
    showOk('nbStOk', 'Password updated! Redirecting…');
    setTimeout(() => { window.history.replaceState({}, '', window.location.pathname); goPanel('Login'); }, 2000);
  }

  /* ════════════════════════════════════════════════════
     Google OAuth redirect
  ════════════════════════════════════════════════════ */
  function triggerGoogle() {
    const clientId = window._GOOGLE_CLIENT_ID;
    if (!clientId) { console.error('Nebulux: _GOOGLE_CLIENT_ID not set'); return; }
    const bL = $('nbGoogL'), bR = $('nbGoogR');
    if (bL) { bL.disabled = true; bL.textContent = 'Redirecting…'; }
    if (bR) { bR.disabled = true; bR.textContent = 'Redirecting…'; }
    const p = new URLSearchParams({ client_id: clientId, redirect_uri: `${location.origin}/api/auth/google/callback/`, response_type: 'code', scope: 'openid email profile', access_type: 'online', prompt: 'select_account' });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /* ════════════════════════════════════════════════════
     Google callback detection
  ════════════════════════════════════════════════════ */
  async function checkGoogleCallback() {
    const p = new URLSearchParams(window.location.search);
    const gAccess = p.get('g_access'), gRefresh = p.get('g_refresh'), gError = p.get('google_error');
    if (gAccess || gRefresh || gError) window.history.replaceState({}, '', window.location.pathname);
    if (gError) { openModal('Login'); showErr('nbLE2', 'Google sign-in failed. Please try again.'); return false; }
    if (!gAccess || !gRefresh) return false;
    S.access = gAccess;
    localStorage.setItem(RT_KEY, gRefresh);
    try {
      const res = await fetch(`${API}/me/`, { headers: { Authorization: `Bearer ${gAccess}` } });
      if (res.ok) { storeSession(gAccess, gRefresh, await res.json()); return true; }
      // Only wipe tokens on a confirmed auth failure (401/403).
      // On 5xx / network error keep the tokens and let doRefresh() sort it out.
      if (res.status === 401 || res.status === 403) {
        S.access = null; localStorage.removeItem(RT_KEY); return false;
      }
      // Server error after Google callback — still have valid tokens, proceed.
      document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: null } }));
      scheduleRefresh();
      return true;
    } catch {
      // Network error — tokens are fine, server is unreachable. Let doRefresh retry.
      scheduleRefresh();
      return true;
    }
  }

  /* ─── Visibility-change guard ────────────────────────
   * Mobile browsers and some desktop ones throttle or
   * freeze JS timers for background tabs. When the tab
   * becomes visible again the scheduled doRefresh() timer
   * may be late or have never fired — so the access token
   * could already be expired. Rather than letting the first
   * API call fail and recover via a 401 → silentRefresh
   * round-trip, we proactively refresh here.
   * ─────────────────────────────────────────────────── */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!S.access) return;
    const ttl = msTilExp(S.access);
    // Token expired or expiring within 2 minutes — refresh immediately.
    if (ttl < LEAD_MS) doRefresh();
  });

  /* ════════════════════════════════════════════════════
     Session restore on page load
     ─────────────────────────────────────────────────
     KEY FIX: restore() NEVER calls clearSession().
     If the refresh fails, we clear only localStorage and
     return silently — no auth:logout event is fired.
     The builder's 10-second guard handles the timeout.
     clearSession() (and therefore auth:logout) is only
     called by doRefresh() on a confirmed dead token, or
     by the explicit user sign-out action.
  ════════════════════════════════════════════════════ */
  async function restore() {
    const rt = localStorage.getItem(RT_KEY);
    if (!rt) return;

    // Use silentRefresh() so this goes through the same dedup/mutex
    // mechanism as doRefresh and authFetch. This prevents the restore()
    // call from racing with other refresh attempts.
    const ok = await silentRefresh();
    if (!ok || !S.access) {
      // If refresh failed but we still have the RT, schedule a retry
      // via doRefresh rather than silently giving up.
      if (localStorage.getItem(RT_KEY)) {
        _refreshRetries = 0;
        S.timer = setTimeout(doRefresh, 15_000);
      }
      return;
    }

    // Token refreshed successfully — now fetch user profile.
    try {
      const res = await fetch(`${API}/me/`, {
        headers: { Authorization: `Bearer ${S.access}` },
      });
      if (res.ok) {
        S.user = await res.json();
        syncUI();
        document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: S.user } }));
        // Show onboarding for first-time users who refreshed before completing it
        if (S.user && S.user.has_onboarded === false) {
          setTimeout(_showOnboarding, 400);
        }
      } else if (res.status === 401 || res.status === 403) {
        // Access token was rejected by /me/ — stale.
        // Clear access token but keep refresh token; doRefresh will sort it out.
        S.access = null;
        document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: null } }));
      } else {
        // Transient server error on /me/ — token is fine, server is flaky.
        document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: S.user || null } }));
      }
    } catch {
      // Network error on /me/ — still have a valid access token in memory.
      document.dispatchEvent(new CustomEvent('auth:login', { detail: { user: null } }));
    }
  }

  /* ════════════════════════════════════════════════════
     Profile dropdown
  ════════════════════════════════════════════════════ */
  function updateDropdownAuthState() {
    const sp = $('dropdownSigninPanel'), pc = $('dropdownPlanCard'), da = $('dropdownAuthenticated');
    if (!sp) return;
    if (S.user) { sp.style.display = 'none'; if (pc) pc.style.display = ''; if (da) da.style.display = ''; }
    else        { sp.style.display = '';     if (pc) pc.style.display = 'none'; if (da) da.style.display = 'none'; }
  }

  function setupDropdown() {
    const btn = $('profileIconBtn'), dd = $('profileDropdown');
    if (!btn || !dd) return;
    btn.addEventListener('click', e => { e.stopPropagation(); updateDropdownAuthState(); const o = dd.classList.toggle('open'); btn.classList.toggle('active', o); });
    document.addEventListener('click', () => { dd.classList.remove('open'); btn.classList.remove('active'); });
    dd.addEventListener('click', e => e.stopPropagation());
    $('dropdownSigninBtn')?.addEventListener('click', () => { dd.classList.remove('open'); btn.classList.remove('active'); openModal('Login'); });
  }

  function openSettings(tab = 'account') {
    const ov = $('accountModalOverlay'); if (!ov) return; ov.style.display = 'flex';
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel${cap(tab)}`));
  }
  function closeSettings() { const ov = $('accountModalOverlay'); if (ov) ov.style.display = 'none'; }
  function openSignout()   { const el = $('signoutConfirm'); if (el) el.style.display = 'flex'; }
  function closeSignout()  { const el = $('signoutConfirm'); if (el) el.style.display = 'none'; }

  async function logout() {
    const rt = localStorage.getItem(RT_KEY);
    try { if (rt) await authFetch(`${API}/logout/`, { method: 'POST', body: JSON.stringify({ refresh: rt }) }); } catch {}
    clearSession();
  }
  async function doSignout() { await logout(); closeSignout(); $('profileDropdown')?.classList.remove('open'); }

  async function saveProfile() {
    const el = $('accountName'); if (!el) return;
    const res = await authFetch(`${API}/me/`, { method: 'PUT', body: JSON.stringify({ name: el.value.trim() }) });
    if (res.ok) {
      S.user = await res.json(); syncUI();
      const b = $('accountSaveBtn'); if (b) { const o = b.textContent; b.textContent = 'Saved ✓'; setTimeout(() => b.textContent = o, 2000); }
    }
  }

  /* ════════════════════════════════════════════════════
     Password toggles
  ════════════════════════════════════════════════════ */
  function setupPwToggles() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('.nb-pw'); if (!btn) return;
      const inp = $(btn.dataset.for); if (!inp) return;
      const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE_ON;
    });
  }

  /* ════════════════════════════════════════════════════
     Init
  ════════════════════════════════════════════════════ */
  function $(id) { return document.getElementById(id); }

  function inject() {
    if (!document.querySelector('link[href*="Space+Grotesk"]')) {
      document.head.appendChild(Object.assign(document.createElement('link'), {
        rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap',
      }));
    }
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    const t = document.createElement('div'); t.innerHTML = HTML; document.body.appendChild(t.firstElementChild);
  }

  function wire() {
    $('nbX')?.addEventListener('click', closeModal);
    $('nbOv')?.addEventListener('click', e => { if (e.target.id === 'nbOv') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeSettings(); closeSignout(); } });
    $('nbToReg')?.addEventListener('click',     () => goPanel('Reg'));
    $('nbToLogin')?.addEventListener('click',   () => goPanel('Login'));
    $('nbForgotLink')?.addEventListener('click',() => goPanel('Fgt'));
    $('nbFBack')?.addEventListener('click',     () => goPanel('Login'));
    $('nbOBack')?.addEventListener('click',     () => goPanel('Reg'));
    $('nbLE')?.addEventListener('input', () => hideMsg('nbLE2'));
    $('nbLP')?.addEventListener('input', () => hideMsg('nbLE2'));
    $('nbLF')?.addEventListener('submit', onLogin);
    $('nbRF')?.addEventListener('submit', onRegister);
    $('nbOF')?.addEventListener('submit', onOtp);
    $('nbFF')?.addEventListener('submit', onForgot);
    $('nbStF')?.addEventListener('submit', onReset);
    $('nbResend')?.addEventListener('click', onResend);
    $('nbOI')?.addEventListener('input', e => syncDots(e.target.value));
    $('nbGoogL')?.addEventListener('click', triggerGoogle);
    $('nbGoogR')?.addEventListener('click', triggerGoogle);
    setupDropdown();
    $('dropdownSignoutBtn')?.addEventListener('click', () => { $('profileDropdown')?.classList.remove('open'); openSignout(); });
// FIND (line ~825):
    $('dropdownAccountBtn')?.addEventListener('click', () => { $('profileDropdown')?.classList.remove('open'); window.location.href = '/settings/'; });
    $('dropdownUpgradeBtn')?.addEventListener('click', () => { $('profileDropdown')?.classList.remove('open'); window.location.href = '/settings/?tab=subscription'; });
    $('accountModalClose')?.addEventListener('click', closeSettings);
    $('accountModalOverlay')?.addEventListener('click', e => { if (e.target.id === 'accountModalOverlay') closeSettings(); });
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.addEventListener('click', () => openSettings(b.dataset.tab)));
    $('accountSaveBtn')?.addEventListener('click', saveProfile);
    $('signoutCancelBtn')?.addEventListener('click', closeSignout);
    $('signoutGoBtn')?.addEventListener('click', doSignout);
    if (new URLSearchParams(window.location.search).get('token')) openModal('Rst');
  }

  async function init() {
    inject(); setupPwToggles(); wire();
    const googleHandled = await checkGoogleCallback();
    if (!googleHandled) await restore();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ════════════════════════════════════════════════════
     Onboarding — first-time users only
  ════════════════════════════════════════════════════ */

  const OB_CSS = `
.ob-overlay {
  position:fixed; inset:0; z-index:10000;
  background:#0a0a0f;
  display:flex; align-items:center; justify-content:center;
  opacity:0; transition:opacity .5s ease;
  font-family:'Outfit',sans-serif;
}
.ob-overlay.ob-visible { opacity:1; }
.ob-overlay[hidden] { display:none!important; }

.ob-container {
  width:100%; max-width:520px; padding:40px 32px;
  display:flex; flex-direction:column; align-items:center;
  text-align:center;
}

.ob-progress {
  display:flex; gap:8px; margin-bottom:48px;
}
.ob-progress-dot {
  width:32px; height:3px; border-radius:2px;
  background:rgba(255,255,255,.1); transition:background .3s ease;
}
.ob-progress-dot.active { background:#fff; }
.ob-progress-dot.done { background:rgba(255,255,255,.35); }

.ob-step {
  display:none; flex-direction:column; align-items:center;
  width:100%;
  animation:ob-fadein .35s ease;
}
.ob-step.ob-active { display:flex; }

@keyframes ob-fadein {
  from { opacity:0; transform:translateY(12px); }
  to { opacity:1; transform:translateY(0); }
}

.ob-question {
  font-family:'Space Grotesk','Outfit',sans-serif;
  font-size:24px; font-weight:700; color:#fff;
  letter-spacing:-0.5px; line-height:1.3;
  margin:0 0 8px;
}

.ob-subtitle {
  font-size:14px; color:rgba(255,255,255,.35);
  margin:0 0 32px; line-height:1.5;
}

.ob-choices {
  display:flex; flex-wrap:wrap; gap:10px;
  justify-content:center; max-width:440px;
}

.ob-chip {
  padding:10px 20px; border-radius:100px;
  border:1.5px solid rgba(255,255,255,.12); background:transparent;
  font-family:'Outfit',sans-serif; font-size:14px; font-weight:500;
  color:rgba(255,255,255,.6); cursor:pointer;
  transition:all .18s ease; user-select:none;
}
.ob-chip:hover { border-color:rgba(255,255,255,.25); color:rgba(255,255,255,.8); }
.ob-chip.ob-selected {
  background:#fff; border-color:#fff; color:#0a0a0f;
  transform:scale(1.03);
  box-shadow:0 2px 16px rgba(255,255,255,.1);
}

.ob-custom-row {
  display:none; margin-top:12px; width:100%; max-width:320px;
}
.ob-custom-row.ob-visible { display:flex; }
.ob-custom-input {
  width:100%; padding:10px 16px; border-radius:10px;
  border:1.5px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05);
  font-family:'Outfit',sans-serif; font-size:14px; color:#fff;
  outline:none; text-align:center;
  transition:border-color .2s, background .2s;
}
.ob-custom-input:focus { border-color:rgba(255,255,255,.4); background:rgba(255,255,255,.08); }
.ob-custom-input::placeholder { color:rgba(255,255,255,.2); }

.ob-next {
  margin-top:36px; padding:13px 36px;
  background:#fff; border:none; border-radius:10px;
  font-family:'Outfit',sans-serif; font-size:14px; font-weight:600;
  color:#0a0a0f; cursor:pointer;
  opacity:0; transform:translateY(8px);
  transition:opacity .3s, transform .3s, background .15s;
  pointer-events:none;
}
.ob-next.ob-show {
  opacity:1; transform:translateY(0); pointer-events:auto;
}
.ob-next:hover { background:rgba(255,255,255,.88); }
.ob-next:active { transform:translateY(1px); }

.ob-logo-mark {
  margin-bottom:32px;
}
`;

  const OB_QUESTIONS = [
    {
      key: 'heard_from',
      question: 'How did you hear about us?',
      subtitle: 'We\'d love to know what brought you here',
      choices: ['Twitter / X', 'YouTube', 'Google Search', 'Friend / Colleague', 'Reddit', 'Product Hunt'],
      hasCustom: true,
    },
    {
      key: 'role',
      question: 'What\'s your role?',
      subtitle: 'This helps us tailor your experience',
      choices: ['Developer', 'Designer', 'Founder / CEO', 'Marketer', 'Student', 'Freelancer'],
      hasCustom: true,
    },
    {
      key: 'use_case',
      question: 'What will you build?',
      subtitle: 'Pick what best describes your first project',
      choices: ['Business Website', 'Portfolio', 'Landing Page', 'Client Project', 'Side Project', 'Just Exploring'],
      hasCustom: false,
    },
  ];

  function _buildOnboardingHTML() {
    let steps = '';
    OB_QUESTIONS.forEach((q, i) => {
      let chips = q.choices.map(c =>
        `<button class="ob-chip" data-value="${c}">${c}</button>`
      ).join('');
      if (q.hasCustom) {
        chips += `<button class="ob-chip" data-value="__custom__" style="border-style:dashed;color:rgba(255,255,255,.3)">Something else…</button>`;
      }
      const customRow = q.hasCustom
        ? `<div class="ob-custom-row" data-custom-step="${i}"><input class="ob-custom-input" placeholder="Type your answer…" data-custom-key="${q.key}"></div>`
        : '';
      steps += `
        <div class="ob-step" data-ob-step="${i}">
          <h2 class="ob-question">${q.question}</h2>
          <p class="ob-subtitle">${q.subtitle}</p>
          <div class="ob-choices" data-ob-key="${q.key}">
            ${chips}
          </div>
          ${customRow}
          <button class="ob-next" data-ob-next="${i}">
            ${i < OB_QUESTIONS.length - 1 ? 'Continue →' : 'Let\'s go →'}
          </button>
        </div>`;
    });

    return `
      <div id="obOverlay" class="ob-overlay" hidden>
        <div class="ob-container">
          <img class="ob-logo-mark" src="/static/img/logo.png" alt="Nebulux" style="width:40px;height:40px;object-fit:contain">
          <div class="ob-progress">
            ${OB_QUESTIONS.map((_, i) => `<div class="ob-progress-dot" data-ob-prog="${i}"></div>`).join('')}
          </div>
          ${steps}
        </div>
      </div>`;
  }

  let _obAnswers = {};
  let _obStep = 0;

  function _showOnboarding() {
    // Guard: don't inject twice
    if (document.getElementById('obOverlay')) return;

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = OB_CSS;
    document.head.appendChild(style);

    // Inject HTML
    const wrap = document.createElement('div');
    wrap.innerHTML = _buildOnboardingHTML();
    document.body.appendChild(wrap.firstElementChild);

    const overlay = document.getElementById('obOverlay');
    overlay.removeAttribute('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('ob-visible')));
    document.body.style.overflow = 'hidden';

    _obStep = 0;
    _obAnswers = {};
    _goToObStep(0);

    // Wire chip clicks
    overlay.querySelectorAll('.ob-choices').forEach(group => {
      group.addEventListener('click', e => {
        const chip = e.target.closest('.ob-chip');
        if (!chip) return;

        const key = group.dataset.obKey;
        const val = chip.dataset.value;
        const stepIdx = parseInt(chip.closest('.ob-step').dataset.obStep);
        const customRow = overlay.querySelector(`[data-custom-step="${stepIdx}"]`);

        if (val === '__custom__') {
          const wasSelected = chip.classList.contains('ob-selected');
          group.querySelectorAll('.ob-chip').forEach(c => c.classList.remove('ob-selected'));
          if (!wasSelected) {
            chip.classList.add('ob-selected');
            if (customRow) {
              customRow.classList.add('ob-visible');
              customRow.querySelector('.ob-custom-input')?.focus();
            }
            delete _obAnswers[key]; // will be set from input
          } else {
            if (customRow) customRow.classList.remove('ob-visible');
            delete _obAnswers[key];
          }
        } else {
          group.querySelectorAll('.ob-chip').forEach(c => c.classList.remove('ob-selected'));
          chip.classList.add('ob-selected');
          if (customRow) customRow.classList.remove('ob-visible');
          _obAnswers[key] = val;
        }

        // Show/hide next button
        _syncObNext(stepIdx);
      });
    });

    // Wire custom inputs
    overlay.querySelectorAll('.ob-custom-input').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.customKey;
        const val = input.value.trim();
        if (val) _obAnswers[key] = val;
        else delete _obAnswers[key];
        const stepIdx = parseInt(input.closest('.ob-step')?.dataset.obStep || '0');
        _syncObNext(stepIdx);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const stepIdx = parseInt(input.closest('.ob-step')?.dataset.obStep || '0');
          const btn = overlay.querySelector(`[data-ob-next="${stepIdx}"]`);
          if (btn?.classList.contains('ob-show')) btn.click();
        }
      });
    });

    // Wire next buttons
    overlay.querySelectorAll('.ob-next').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.obNext);
        if (idx < OB_QUESTIONS.length - 1) {
          _obStep = idx + 1;
          _goToObStep(_obStep);
        } else {
          _submitOnboarding();
        }
      });
    });
  }

  function _goToObStep(idx) {
    const overlay = document.getElementById('obOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('.ob-step').forEach(s => s.classList.remove('ob-active'));
    const step = overlay.querySelector(`[data-ob-step="${idx}"]`);
    if (step) step.classList.add('ob-active');

    // Update progress dots
    overlay.querySelectorAll('.ob-progress-dot').forEach(d => {
      const i = parseInt(d.dataset.obProg);
      d.classList.toggle('done', i < idx);
      d.classList.toggle('active', i === idx);
    });
  }

  function _syncObNext(stepIdx) {
    const overlay = document.getElementById('obOverlay');
    const key = OB_QUESTIONS[stepIdx].key;
    const btn = overlay?.querySelector(`[data-ob-next="${stepIdx}"]`);
    if (btn) btn.classList.toggle('ob-show', !!_obAnswers[key]);
  }

  async function _submitOnboarding() {
    const overlay = document.getElementById('obOverlay');
    const btn = overlay?.querySelector(`[data-ob-next="${OB_QUESTIONS.length - 1}"]`);
    if (btn) { btn.textContent = 'Setting up…'; btn.style.pointerEvents = 'none'; }

    try {
      const res = await authFetch(`${API}/onboarding/`, {
        method: 'POST',
        body: JSON.stringify(_obAnswers),
      });
      if (res.ok) {
        const user = await res.json();
        S.user = user;
        syncUI();
      }
    } catch (_) {}

    // Close overlay
    if (overlay) {
      overlay.classList.remove('ob-visible');
      setTimeout(() => { overlay.remove(); document.body.style.overflow = ''; }, 500);
    }
  }

  // ── Hook: check after login if user needs onboarding ──
  // (integrated directly into storeSession above)

  window.Auth = { open: openModal, close: closeModal, panel: goPanel, isAuthenticated: () => !!S.access, getUser: () => S.user, authFetch, apiFetch: authFetch, logout };

})();
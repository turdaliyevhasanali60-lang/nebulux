/**
 * settings-page.js — SettingsPage initialisation wrapper
 *
 * Exports initSettings() called from SettingsPage useEffect after mount.
 * All logic preserved exactly from the original settings.js.
 */

export function initSettings() {
  'use strict';

  let _initDone = false;

  function tryInit() {
    if (_initDone) return;
    if (!window.Auth || !Auth.isAuthenticated()) return;
    _initDone = true;
    init();
  }

  document.addEventListener('auth:login', tryInit);
  window.addEventListener('auth:login', tryInit);

  setTimeout(tryInit, 120);

  setTimeout(() => {
    if (!_initDone && (!window.Auth || !Auth.isAuthenticated())) {
      window.location.href = '/';
    }
  }, 4000);

  document.addEventListener('auth:logout', () => { window.location.href = '/'; });
  window.addEventListener('auth:logout',   () => { window.location.href = '/'; });


  function init() {
    initTabs();
    initSignout();

    API.get('/auth/me/').then(freshUser => {
      if (freshUser) {
        const cached = Auth.getUser();
        if (cached) Object.assign(cached, freshUser);
        try { localStorage.setItem('nbx_user', JSON.stringify({ ...cached, ...freshUser })); } catch {}
      }
    }).catch(() => {
    }).finally(() => {
      initProfile();
      initPassword();
      initDeleteAccount();
      initSubscription();

      const urlTab = new URLSearchParams(window.location.search).get('tab');
      if (urlTab && ['profile', 'subscription', 'billing'].includes(urlTab)) {
        switchTab(urlTab);
      }
    });
  }


  function initTabs() {
    document.querySelectorAll('.settings-nav-item, .settings-mobile-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.settings-nav-item, .settings-mobile-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    document.querySelectorAll('.settings-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'panel' + capitalize(tab));
    });

    if (tab === 'billing') loadBilling();

    const url = new URL(window.location);
    tab === 'profile' ? url.searchParams.delete('tab') : url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url);
  }


  function initProfile() {
    const user = Auth.getUser();
    if (!user) return;

    const nameInp     = document.getElementById('settingsName');
    const emailInp    = document.getElementById('settingsEmail');
    const avatarName  = document.getElementById('settingsAvatarName');
    const avatarEmail = document.getElementById('settingsAvatarEmail');
    const saveBtn     = document.getElementById('settingsSaveBtn');
    const saveStatus  = document.getElementById('settingsSaveStatus');

    if (nameInp)     nameInp.value           = user.name || '';
    if (emailInp)    emailInp.value          = user.email || '';
    if (avatarName)  avatarName.textContent  = user.name || user.email.split('@')[0];
    if (avatarEmail) avatarEmail.textContent = user.email;

    saveBtn?.addEventListener('click', async () => {
      const name = nameInp?.value.trim() || '';
      const orig = saveBtn.textContent;
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;
      try {
        const updated = await API.put('/auth/me/', { name });
        const u = Auth.getUser();
        if (u) u.name = updated.name || name;
        if (avatarName) avatarName.textContent = updated.name || updated.email.split('@')[0];
        flash(saveStatus, 'Saved ✓', '#4ade80');
      } catch (err) {
        flash(saveStatus, 'Error saving', '#f87171');
      } finally {
        saveBtn.textContent = orig;
        saveBtn.disabled = false;
      }
    });
  }


  function initPassword() {
    const user = Auth.getUser();
    const card = document.getElementById('passwordCard');
    if (!card) return;

    const isOAuth = !user || user.has_usable_password === false || !!user.google_id;
    if (isOAuth) {
      card.innerHTML = `
        <div class="settings-card-label">Password</div>
        <p class="settings-card-desc">You signed in with Google. Password management is not available for your account.</p>`;
      return;
    }

    const btn    = document.getElementById('changePasswordBtn');
    const status = document.getElementById('passwordStatus');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const current = document.getElementById('currentPassword')?.value || '';
      const next    = document.getElementById('newPassword')?.value || '';
      const confirm = document.getElementById('confirmPassword')?.value || '';

      if (!current || !next || !confirm) {
        flash(status, 'Please fill in all fields.', '#f87171'); return;
      }
      if (next.length < 8) {
        flash(status, 'New password must be at least 8 characters.', '#f87171'); return;
      }
      if (next !== confirm) {
        flash(status, 'Passwords do not match.', '#f87171'); return;
      }

      const orig = btn.textContent;
      btn.textContent = 'Updating…'; btn.disabled = true;
      try {
        await API.post('/auth/change-password/', { current_password: current, new_password: next });
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        flash(status, 'Password updated ✓', '#4ade80');
      } catch (err) {
        const msg = err?.data?.error
          || err?.data?.current_password?.[0]
          || err?.data?.new_password?.[0]
          || 'Could not update password.';
        flash(status, msg, '#f87171');
      } finally {
        btn.textContent = orig; btn.disabled = false;
      }
    });
  }


  function initDeleteAccount() {
    const openBtn    = document.getElementById('deleteAccountBtn');
    const cancelBtn  = document.getElementById('deleteCancelBtn');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    const confirmBox = document.getElementById('deleteConfirmBox');
    const input      = document.getElementById('deleteConfirmInput');
    if (!openBtn) return;

    openBtn.addEventListener('click', () => {
      confirmBox.style.display = 'block';
      openBtn.style.display = 'none';
      input?.focus();
    });

    cancelBtn?.addEventListener('click', () => {
      confirmBox.style.display = 'none';
      openBtn.style.display = '';
      if (input) input.value = '';
      if (confirmBtn) confirmBtn.disabled = true;
    });

    input?.addEventListener('input', () => {
      if (confirmBtn) confirmBtn.disabled = input.value.trim() !== 'DELETE';
    });

    confirmBtn?.addEventListener('click', async () => {
      confirmBtn.textContent = 'Deleting…'; confirmBtn.disabled = true;
      try {
        await API.del('/auth/me/');
        if (window.Auth) await Auth.logout();
        window.location.href = '/';
      } catch (err) {
        confirmBtn.textContent = 'Delete my account'; confirmBtn.disabled = false;
        const p = document.createElement('p');
        p.style.cssText = 'color:#f87171;font-size:12px;margin-top:8px;margin-bottom:0;';
        p.textContent = err?.data?.error || 'Something went wrong. Please contact support.';
        confirmBox.appendChild(p);
        setTimeout(() => p.remove(), 5000);
      }
    });
  }


  function initSubscription() {
    const user = Auth.getUser();
    if (!user) return;

    const plan    = user.plan || 'free';
    const credits = user.credits ?? 0;
    const limit   = user.monthly_credit_limit ?? (plan === 'free' ? 30 : 0);
    const pct     = limit > 0 ? Math.min(100, Math.round((credits / limit) * 100)) : 0;

    setText('subPlanName', capitalize(plan));
    setText('subCreditsDisplay', `${credits.toLocaleString()} / ${limit.toLocaleString()}`);

    const meter = document.getElementById('subCreditsMeter');
    if (meter) {
      meter.style.width = pct + '%';
      meter.classList.toggle('low', limit > 0 && pct < 20);
    }

    setText('subCreditsNote', `${pct}% used · Resets on the 1st of each month`);

    renderPlanGrid(plan);
  }

  function renderPlanGrid(currentPlan) {
    const grid = document.getElementById('settingsPlanGrid');
    if (!grid) return;

    const chk = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const plans = [
      {
        key: 'free',
        name: 'Free',
        credits: '200 credits',
        price: '$0',
        period: '/month',
        features: ['200 credits / month', 'Browse & explore only', '1 project', 'Community support'],
        comingSoon: false,
      },
      {
        key: 'standard',
        name: 'Standard',
        credits: '2,000 credits',
        price: '$14.99',
        period: '/m billed monthly',
        features: ['~30 websites / month', 'Unlimited pages per website', '5 projects', 'Unlimited export', 'Email support', 'Purchase additional credits'],
        comingSoon: false,
      },
      {
        key: 'pro',
        name: 'Pro',
        credits: '5,000 credits',
        price: '$29',
        period: '/m billed monthly',
        features: ['~75 websites / month', 'Unlimited pages per website', 'Unlimited projects', 'Unlimited export to code', 'Purchase additional credits', 'Priority support'],
        comingSoon: false,
      },
    ];

    const packs = [
      { key: 'starter_pack',  name: 'Starter Pack',  tu: '400 TU',   price: '$4.99',  per: '$0.0125/TU', desc: '~6 generations' },
      { key: 'builder_pack',  name: 'Builder Pack',  tu: '850 TU',   price: '$8.99',  per: '$0.0106/TU', desc: '~13 generations', popular: true },
      { key: 'agency_pack',   name: 'Agency Pack',   tu: '1,600 TU', price: '$14.99', per: '$0.0094/TU', desc: '~24 generations', bestValue: true },
    ];

    grid.innerHTML = plans.map(p => {
      const isCurrent = p.key === currentPlan;
      const label = isCurrent ? 'Current plan' : (p.comingSoon ? 'Coming Soon' : 'Upgrade');
      const cls   = isCurrent ? 'secondary' : 'accent';
      return `
        <div class="plan-tile${isCurrent ? ' current popular' : ''}">
          ${isCurrent ? '<div class="plan-tile-badge">Your plan</div>' : ''}
          <div class="plan-tile-name">${p.name}</div>
          <div class="plan-tile-credits">${p.credits}</div>
          <div class="plan-tile-price">${p.price}</div>
          <div class="plan-tile-period">${p.period}</div>
          <ul class="plan-tile-features">${p.features.map(f => `<li>${chk}<span>${f}</span></li>`).join('')}</ul>
          <button class="settings-btn ${cls}" ${(isCurrent || p.comingSoon) ? 'disabled' : ''} data-plan="${p.key}">${label}</button>
        </div>`;
    }).join('');

    grid.querySelectorAll('.settings-btn[data-plan]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const plan = btn.dataset.plan;
        const product = plan === 'pro' ? 'pro_monthly' : 'standard_monthly';
        btn.disabled = true;
        btn.textContent = 'Loading…';
        try {
          const data = await API.post('/payments/create-checkout/', { product });
          if (data.checkout_url) window.location.href = data.checkout_url;
          else { btn.disabled = false; btn.textContent = 'Upgrade'; }
        } catch(e) {
          btn.disabled = false; btn.textContent = 'Upgrade';
          alert('Checkout error. Please try again.');
        }
      });
    });

    const packsWrap = document.getElementById('settingsPacksWrap');
    if (packsWrap) {
      if (currentPlan === 'standard') {
        packsWrap.style.display = '';
        packsWrap.innerHTML = `
          <div class="settings-card-label" style="margin-top:20px">Credit Packs</div>
          <div class="plan-grid" style="margin-top:12px">${packs.map(p => `
            <div class="plan-tile${p.popular ? ' current popular' : ''}">
              ${p.popular ? '<div class="plan-tile-badge">Popular</div>' : ''}
              ${p.bestValue ? '<div class="plan-tile-badge" style="background:rgba(0,200,100,0.15);color:#00c864">Best Value</div>' : ''}
              <div class="plan-tile-name">${p.name}</div>
              <div class="plan-tile-credits">${p.tu}</div>
              <div class="plan-tile-price">${p.price}</div>
              <div class="plan-tile-period">${p.per} · ${p.desc}</div>
              <button class="settings-btn accent" data-pack="${p.key}">Buy</button>
            </div>`).join('')}
          </div>`;
        packsWrap.querySelectorAll('.settings-btn[data-pack]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const pack = btn.dataset.pack;
            btn.disabled = true; btn.textContent = 'Loading…';
            try {
              const data = await API.post('/payments/create-checkout/', { product: pack });
              if (data.checkout_url) window.location.href = data.checkout_url;
              else { btn.disabled = false; btn.textContent = 'Buy'; }
            } catch(e) {
              btn.disabled = false; btn.textContent = 'Buy';
              alert('Checkout error. Please try again.');
            }
          });
        });
      } else {
        packsWrap.style.display = 'none';
      }
    }
  }


  let _bData = null, _bLoaded = false, _bLoading = false;

  async function loadBilling(force) {
    if (_bLoading) return;
    if (_bLoaded && !force) { renderBilling(_bData); return; }

    _bLoading = true;
    const content = document.getElementById('billingContent');
    if (!content) { _bLoading = false; return; }

    content.innerHTML = '<div class="settings-loader"><div class="settings-spinner"></div><span>Loading billing info…</span></div>';

    try {
      _bData = await API.get('/payments/billing/');
      _bLoaded = true;
      renderBilling(_bData);
    } catch (err) {
      content.innerHTML = '<div class="billing-history-empty">Could not load billing information.<br><button class="settings-btn secondary" style="margin-top:14px" id="bilRetry">Retry</button></div>';
      document.getElementById('bilRetry')?.addEventListener('click', () => loadBilling(true));
    } finally {
      _bLoading = false;
    }
  }

  function renderBilling(d) {
    const el = document.getElementById('billingContent');
    if (!el || !d) return;

    const plan     = capitalize(d.plan || 'free');
    const sub      = d.subscription;
    const txs      = d.payments || [];
    const hasSub   = sub?.status === 'active';
    const canceled = sub?.status === 'canceled';
    const pastDue  = sub?.status === 'past_due';

    let h = '';

    h += '<div class="settings-card"><div class="settings-card-label">Subscription</div>';
    h += '<div class="billing-sub-card"><div class="billing-sub-info">';
    h += '<div class="billing-sub-plan">' + plan + ' Plan';
    if (hasSub)   h += ' <span class="billing-badge active">Active</span>';
    if (canceled) h += ' <span class="billing-badge canceled">Canceled</span>';
    if (pastDue)  h += ' <span class="billing-badge past-due">Past Due</span>';
    h += '</div><div class="billing-sub-meta">';
    if (hasSub && sub.current_period_end)     h += 'Next billing: ' + fmtDate(sub.current_period_end);
    else if (canceled && sub.current_period_end) h += 'Access until: ' + fmtDate(sub.current_period_end);
    else h += 'No active subscription';
    h += '</div></div><div class="billing-sub-actions">';

    if (hasSub) {
      h += '<button class="settings-btn secondary" id="bilPM">Update payment method</button>';
      h += '<button class="billing-danger-link" id="bilCancel">Cancel subscription</button>';
    } else if (canceled) {
      h += '<button class="settings-btn accent" onclick="location.href=\'/pricing/\'">Resubscribe</button>';
    } else {
      h += '<button class="settings-btn accent" onclick="location.href=\'/pricing/\'">Upgrade</button>';
    }
    h += '</div></div>';

    if (hasSub) {
      h += '<div class="billing-cancel-box" id="bilCancelBox">';
      h += '<p>Are you sure? You\'ll keep access until <strong>' + fmtDate(sub.current_period_end) + '</strong>, then your account reverts to the free plan.</p>';
      h += '<div class="billing-cancel-btns">';
      h += '<button class="settings-btn secondary" id="bilCancelNo">Keep my plan</button>';
      h += '<button class="settings-btn danger" id="bilCancelYes">Cancel subscription</button>';
      h += '</div></div>';
    }
    h += '</div>';

    h += '<div class="settings-card"><div class="settings-card-label">Payment history</div>';
    if (txs.length === 0) {
      h += '<div class="billing-history-empty">No payments yet</div>';
    } else {
      txs.forEach(p => {
        h += '<div class="billing-tx"><div class="billing-tx-left">';
        h += '<span class="billing-tx-desc">' + esc(p.description || typeLabel(p.type)) + '</span>';
        h += '<span class="billing-tx-date">' + fmtDate(p.created_at) + '</span>';
        h += '</div><div class="billing-tx-right">';
        h += '<span class="billing-tx-amount">' + fmtCents(p.amount_cents, p.currency) + '</span>';
        if (p.credits_granted > 0) h += '<span class="billing-tx-credits">+' + p.credits_granted.toLocaleString() + ' credits</span>';
        h += '</div></div>';
      });
    }
    h += '</div>';

    el.innerHTML = h;
    wireBilling();
  }

  function wireBilling() {
    const cancelBtn = document.getElementById('bilCancel');
    const box       = document.getElementById('bilCancelBox');
    const no        = document.getElementById('bilCancelNo');
    const yes       = document.getElementById('bilCancelYes');
    const pm        = document.getElementById('bilPM');

    cancelBtn?.addEventListener('click', () => { box?.classList.add('open'); cancelBtn.style.display = 'none'; });
    no?.addEventListener('click', () => { box?.classList.remove('open'); if (cancelBtn) cancelBtn.style.display = ''; });

    yes?.addEventListener('click', async () => {
      yes.textContent = 'Canceling…'; yes.disabled = true;
      if (no) no.disabled = true;
      try {
        await API.post('/payments/cancel-subscription/');
        _bLoaded = false;
        await loadBilling(true);
        initSubscription();
      } catch (err) {
        yes.textContent = 'Cancel subscription'; yes.disabled = false;
        if (no) no.disabled = false;
        const p = document.createElement('p');
        p.style.cssText = 'color:#f87171;font-size:12px;margin-top:10px;margin-bottom:0;';
        p.textContent = err?.data?.error || 'Something went wrong. Please try again.';
        box?.appendChild(p);
        setTimeout(() => p.remove(), 5000);
      }
    });

    pm?.addEventListener('click', async () => {
      const orig = pm.textContent; pm.textContent = 'Loading…'; pm.disabled = true;
      try {
        const res = await API.post('/payments/update-payment-method/');
        if (res.update_url) window.open(res.update_url, '_blank');
        else throw new Error('No URL');
      } catch {
        pm.textContent = 'Error — try again';
        setTimeout(() => { pm.textContent = orig; pm.disabled = false; }, 3000);
      } finally {
        pm.disabled = false;
        if (pm.textContent === 'Loading…') pm.textContent = orig;
      }
    });
  }


  function initSignout() {
    document.getElementById('settingsSignoutBtn')?.addEventListener('click', async () => {
      if (window.Auth) await Auth.logout();
      window.location.href = '/';
    });
  }


  function flash(el, text, color) {
    if (!el) return;
    el.textContent = text;
    el.style.color = color || '';
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; }
  }
  function fmtCents(c, cur) {
    const a = (c || 0) / 100, code = (cur || 'usd').toUpperCase();
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2 }).format(a); } catch { return '$' + a.toFixed(2); }
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function typeLabel(t) { return t === 'subscription' ? 'Subscription' : t === 'credit_pack' ? 'Credit Pack' : t || 'Payment'; }
}

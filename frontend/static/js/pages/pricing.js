/**
 * Nebulux Pricing Page — pages/pricing.js
 * ─────────────────────────────────────────────────────────
 * Handles:
 *  • Standard plan subscription checkout via Lemon Squeezy
 *  • One-time credit pack purchases
 *  • Payment success / cancel detection from URL params
 *  • Auth gating (must be logged in to purchase)
 *
 * Dependencies (loaded before this file):
 *  • /static/js/core/auth.js   → window.Auth
 *  • /static/js/core/api.js    → window.API
 *  • Toastify.js (CDN)         → window.Toastify
 * ─────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     TOAST  — powered by Toastify.js
     Each type has a matching bespoke style that fits the
     existing Nebulux dark palette.
  ───────────────────────────────────────────────────────── */
  const TOAST_STYLES = {
    success: {
      background: 'rgba(20, 28, 20, 0.95)',
      border:     '1px solid rgba(34, 197, 94, 0.35)',
      color:      '#6ee7a0',
      boxShadow:  '0 12px 40px rgba(0,0,0,0.45)',
    },
    error: {
      background: 'rgba(28, 18, 18, 0.95)',
      border:     '1px solid rgba(239, 68, 68, 0.35)',
      color:      '#fca5a5',
      boxShadow:  '0 12px 40px rgba(0,0,0,0.45)',
    },
    info: {
      background: 'rgba(14, 22, 32, 0.95)',
      border:     '1px solid rgba(77, 157, 224, 0.35)',
      color:      '#9bd4ff',
      boxShadow:  '0 12px 40px rgba(0,0,0,0.45)',
    },
  };

  function showToast(message, type = 'info') {
    const styles = TOAST_STYLES[type] || TOAST_STYLES.info;

    Toastify({
      text:     message,
      duration: 5000,
      gravity:  'top',
      position: 'center',
      stopOnFocus: true,
      style: {
        ...styles,
        fontFamily:   "'Sora', sans-serif",
        fontSize:     '14px',
        fontWeight:   '600',
        padding:      '14px 28px',
        borderRadius: '14px',
        backdropFilter: 'blur(16px)',
        maxWidth:     '460px',
        lineHeight:   '1.5',
      },
    }).showToast();
  }

  /* ─────────────────────────────────────────────────────────
     URL PAYMENT RESULT DETECTION
  ───────────────────────────────────────────────────────── */
  function checkPaymentResult() {
    const params  = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const notice  = params.get('notice');

    if (payment === 'success') {
      showToast('Payment successful! Credits have been added to your account.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'canceled') {
      showToast('Payment was canceled. No charges were made.', 'info');
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (notice === 'templates_coming_soon') {
      showToast('Templates are coming soon! Stay tuned.', 'info');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  /* ─────────────────────────────────────────────────────────
     CHECKOUT  — delegates to API.post for the redirect URL
  ───────────────────────────────────────────────────────── */
  async function startCheckout(productKey, buttonEl) {
    // ── Auth gate ──────────────────────────────────────────
    if (!window.Auth || !Auth.isAuthenticated()) {
      try { sessionStorage.setItem('nbx_after_login', window.location.href); } catch (_) {}

      if (window.Auth) Auth.open('Login');
      else window.location.href = '/?signin=1';

      // Retry after successful login
      document.addEventListener('auth:login', function onLogin() {
        startCheckout(productKey, buttonEl);
      }, { once: true });

      return;
    }

    // ── Loading state ──────────────────────────────────────
    _setButtonLoading(buttonEl, true);

    try {
      const data = await API.post('/payments/create-checkout/', { product: productKey });

      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        showToast('Checkout URL not received. Please try again.', 'error');
      }
    } catch (err) {
      if (err instanceof API.Error) {
        showToast(err.message, 'error');
      } else {
        showToast('Network error. Check your connection and try again.', 'error');
      }
      console.error('[Pricing] Checkout error:', err);
    } finally {
      _setButtonLoading(buttonEl, false);
    }
  }

  function _setButtonLoading(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('loading', on);
  }

  /* ─────────────────────────────────────────────────────────
     BUTTON BINDINGS
  ───────────────────────────────────────────────────────── */
  function bindBuyButtons() {
    // Standard plan subscription
    const standardBtn = document.getElementById('buyStandardBtn');
    if (standardBtn) {
      standardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startCheckout('standard_monthly', standardBtn);
      });
    }

    // One-time credit packs
    document.querySelectorAll('.buy-btn[data-product]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const product = btn.dataset.product;
        if (product) startCheckout(product, btn);
      });
    });
  }

  /* ─────────────────────────────────────────────────────────
     PLAN UI  — enforces blur on disabled plans and
     locks / unlocks the credit pack grid based on plan tier
  ───────────────────────────────────────────────────────── */
  function updatePlanUI() {
    // Always re-enforce blur on Free & Pro cards
    document.querySelectorAll('.plan-disabled').forEach((card) => {
      card.style.setProperty('pointer-events', 'none', 'important');
      const overlay = card.querySelector('.plan-disabled-overlay');
      if (overlay) overlay.style.setProperty('display', 'flex', 'important');
      card.querySelectorAll(':scope > *:not(.plan-disabled-overlay)').forEach((child) => {
        child.style.setProperty('filter',  'blur(3px)', 'important');
        child.style.setProperty('opacity', '0.3',       'important');
      });
    });

    const creditGridOverlay = document.getElementById('creditGridOverlay');
    const creditsUpgradeBtn = document.getElementById('creditsUpgradeBtn');
    const creditOverlayBtn  = document.getElementById('creditOverlayBtn');

    // Not authenticated — treat same as free plan (locked)
    if (!window.Auth || !Auth.isAuthenticated() || !Auth.getUser()) {
      const wrapper = document.getElementById('creditGridWrapper');
      if (wrapper) wrapper.classList.add('credit-grid-locked');
      if (creditGridOverlay) creditGridOverlay.style.display = 'flex';
      return;
    }

    const user        = Auth.getUser();
    const plan        = (user.plan || 'free').toLowerCase();
    const canBuyCredits = plan === 'standard' || plan === 'pro';

    // ── Credit pack lock / unlock ──────────────────────────
    const creditGridWrapper = document.getElementById('creditGridWrapper');
    if (canBuyCredits) {
      creditGridWrapper?.classList.remove('credit-grid-locked');
      if (creditGridOverlay) creditGridOverlay.style.display = 'none';
    } else {
      creditGridWrapper?.classList.add('credit-grid-locked');
      if (creditGridOverlay) creditGridOverlay.style.display = 'flex';
    }

    // Overlay / banner click → smooth-scroll to Standard plan card
    const scrollToStandard = () => {
      document.querySelector('#plans .featured')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    if (creditsUpgradeBtn) creditsUpgradeBtn.onclick = scrollToStandard;
    if (creditOverlayBtn)  creditOverlayBtn.onclick  = scrollToStandard;

    // ── Standard button: show "Current Plan" when already subscribed ──
    if (plan === 'standard') {
      const standardBtn = document.getElementById('buyStandardBtn');
      if (standardBtn) {
        standardBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Current Plan`;
        standardBtn.disabled = true;
        standardBtn.classList.remove('plan-btn-active');
        standardBtn.style.opacity = '0.5';
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    checkPaymentResult();
    bindBuyButtons();

    // Always run updatePlanUI — handles locked state for signed-out users too
    updatePlanUI();

    document.addEventListener('auth:login',  updatePlanUI);
    document.addEventListener('auth:logout', updatePlanUI);
    document.addEventListener('auth:change', updatePlanUI);
  });
})();
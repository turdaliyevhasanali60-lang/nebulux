/**
 * Nebulux Templates Page — pages/templates.js
 * ─────────────────────────────────────────────────────────
 * Dependencies:
 *  • /static/js/core/auth.js  → window.Auth
 *  • /static/js/core/api.js   → window.API (available for future server-
 *                               side template fetches — currently static)
 * ─────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════
     TEMPLATE DATA
     In a future iteration this can be replaced with:
       const templates = await API.get('/templates/');
  ═══════════════════════════════════════════════════════ */
  const templates = [
    {
      name: 'Finance Dashboard',
      desc: 'A comprehensive finance management dashboard with account overview, transaction history, spending analytics, card management, and budget tracking.',
      category: 'dashboard',
      tag: 'Popular',
      uses: '2.4K',
    },
    {
      name: 'Food Delivery',
      desc: 'A clean UI for a food delivery app with restaurant browsing, cuisine categories, cart management, and user profile screens.',
      category: 'ecommerce',
      tag: 'Trending',
      uses: '3.1K',
    },
    {
      name: 'Fitness Tracker',
      desc: 'Health and fitness tracking dashboard with workout plans, progress rings, activity stats, and personalized training insights.',
      category: 'dashboard',
      tag: 'New',
      uses: '1.8K',
    },
    {
      name: 'Travel Planner',
      desc: 'An immersive travel planning platform with destination cards, itinerary builder, map integration, and exploration recommendations.',
      category: 'landing',
      tag: 'Popular',
      uses: '2.1K',
    },
    {
      name: 'Music Player',
      desc: 'A bold music streaming interface with playlist management, library browsing, and discovery features.',
      category: 'saas',
      tag: '',
      uses: '1.5K',
    },
    {
      name: 'Social Feed',
      desc: 'A modern social media feed with photo grid, stories, user profiles, and content discovery — designed for engagement.',
      category: 'portfolio',
      tag: 'Trending',
      uses: '1.3K',
    },
    {
      name: 'Quantum Landing',
      desc: 'Bold hero section with animated gradient mesh, CTA buttons, and feature grid. Perfect for product launches and startup homepages.',
      category: 'landing',
      tag: '',
      uses: '920',
    },
    {
      name: 'Orbit SaaS',
      desc: 'Complete SaaS homepage with pricing table, testimonials, feature showcase, and newsletter signup — ready for your next product.',
      category: 'saas',
      tag: 'New',
      uses: '780',
    },
    {
      name: 'Pulsar Blog',
      desc: 'Clean blog layout with featured post hero, category sidebar, reading time estimates, and a beautiful article reading experience.',
      category: 'blog',
      tag: '',
      uses: '1.1K',
    },
  ];

  /* ═══════════════════════════════════════════════════════
     DOM REFS — resolved once at startup
  ═══════════════════════════════════════════════════════ */
  const $ = (id) => document.getElementById(id);

  const els = {
    grid:               $('templatesGrid'),
    modal:              $('templateModal'),
    modalPreview:       $('modalPreview'),
    modalTitle:         $('modalTitle'),
    modalDesc:          $('modalDesc'),
    modalCopyBtn:       $('modalCopyBtn'),
    modalUseBtn:        $('modalUseBtn'),
    modalClose:         $('modalClose'),
    confirmPanel:       $('confirmPanel'),
    confirmTemplateName: $('confirmTemplateName'),
    confirmGoBtn:       $('confirmGoBtn'),
    confirmBackBtn:     $('confirmBackBtn'),
    filters:            $('templateFilters'),
  };

  let currentTemplate = null;

  /* ═══════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════ */
  function renderTemplates(filter) {
    const list = filter === 'all'
      ? templates
      : templates.filter((t) => t.category === filter);

    els.grid.innerHTML = '';

    list.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.style.animationDelay = `${0.1 + i * 0.05}s`;
      card.dataset.category = t.category;

      card.innerHTML = `
        <div class="template-preview">
          ${t.tag ? `<span class="template-tag">${t.tag}</span>` : ''}
        </div>
        <div class="template-label">
          <h3>${t.name}</h3>
        </div>`;

      card.addEventListener('click', () => openModal(t));
      els.grid.appendChild(card);
    });
  }

  /* ═══════════════════════════════════════════════════════
     MODAL
  ═══════════════════════════════════════════════════════ */
  function openModal(t) {
    currentTemplate = t;
    els.modalPreview.innerHTML = '';
    els.modalTitle.textContent = t.name;
    els.modalDesc.textContent  = t.desc;
    els.modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    els.modal.classList.remove('open');
    document.body.style.overflow = '';
    currentTemplate = null;
    hideConfirmPanel();
  }

  function showConfirmPanel() {
    if (!currentTemplate) return;
    els.confirmTemplateName.textContent = currentTemplate.name;
    els.confirmPanel.classList.add('active');
  }

  function hideConfirmPanel() {
    els.confirmPanel.classList.remove('active');
  }

  /* ── Close triggers ──────────────────────────────────── */
  els.modalClose.addEventListener('click', closeModal);

  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal.classList.contains('open')) closeModal();
  });

  /* ═══════════════════════════════════════════════════════
     COPY PROMPT
  ═══════════════════════════════════════════════════════ */
  els.modalCopyBtn.addEventListener('click', () => {
    if (!currentTemplate) return;

    const prompt = _buildPrompt(currentTemplate);
    const span   = els.modalCopyBtn.querySelector('span');

    const reset = () => { span.textContent = 'Copy Prompt'; };

    navigator.clipboard.writeText(prompt).then(() => {
      span.textContent = 'Copied!';
      setTimeout(reset, 2000);
    }).catch(() => {
      // Fallback for older browsers / non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'absolute';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      span.textContent = 'Copied!';
      setTimeout(reset, 2000);
    });
  });

  /* ═══════════════════════════════════════════════════════
     USE THIS TEMPLATE → confirmation panel
  ═══════════════════════════════════════════════════════ */
  els.modalUseBtn.addEventListener('click', () => {
    if (currentTemplate) showConfirmPanel();
  });

  els.confirmBackBtn.addEventListener('click', hideConfirmPanel);

  /* ── Confirm & Build ─────────────────────────────────── */
  els.confirmGoBtn.addEventListener('click', () => {
    if (!currentTemplate) return;

    const prompt      = _buildPrompt(currentTemplate);
    const builderUrl  = '/builder/?prompt=' + encodeURIComponent(prompt);

    function goToBuilder() {
      try { localStorage.setItem('nebulux_prompt', prompt); } catch (_) {}
      window.location.href = builderUrl;
    }

    function requireAuthThenGo() {
      if (window.Auth && Auth.isAuthenticated()) {
        goToBuilder();
        return;
      }

      // Persist destination so auth.js redirects there after login
      try { sessionStorage.setItem('nbx_after_login', builderUrl); } catch (_) {}

      document.addEventListener('auth:login', function onLogin() {
        try { sessionStorage.removeItem('nbx_after_login'); } catch (_) {}
        goToBuilder();
      }, { once: true });

      if (window.Auth) {
        Auth.open('Login');
      } else {
        // Race condition guard: Auth script may still be loading
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          if (window.Auth) {
            clearInterval(poll);
            Auth.open('Login');
          } else if (attempts >= 30) {
            clearInterval(poll);
            window.location.href = '/?signin=1';
          }
        }, 10);
      }
    }

    requireAuthThenGo();
  });

  /* ═══════════════════════════════════════════════════════
     FILTER PILLS
  ═══════════════════════════════════════════════════════ */
  els.filters.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;

    document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    renderTemplates(pill.dataset.filter);
  });

  /* ═══════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════ */
  function _buildPrompt(t) {
    return `Create a website based on the "${t.name}" template: ${t.desc}`;
  }

  /* ── Bootstrap ───────────────────────────────────────── */
  renderTemplates('all');
})();
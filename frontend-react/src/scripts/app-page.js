/**
 * app-page.js — IndexPage initialisation wrapper
 *
 * This file is a thin wrapper around the original app.js logic.
 * It exports a single `initApp()` function that the React IndexPage
 * component calls from useEffect() after the JSX has been committed
 * to the DOM. All internal logic is preserved exactly from the original.
 */

export function initApp() {
  'use strict';

  window.addEventListener('load', () => {
    document.body.classList.add('page-loaded');
  });

  /* ========== STICKY NAV GLASS EFFECT ========== */
  (function () {
    const nav = document.querySelector('nav');
    if (!nav) return;
    function updateNav() {
      nav.classList.toggle('nav--scrolled', window.scrollY > 10);
    }
    window.addEventListener('scroll', updateNav, { passive: true });
    updateNav();
  })();

  // Prevent bfcache issues
  window.addEventListener('pageshow', (event) => {
    ['errorModal', 'signoutConfirm', 'confirmDeleteModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('active', 'open'); }
    });
    document.body.style.overflow = '';

    const profileDropdown = document.getElementById('profileDropdown');
    if (profileDropdown) profileDropdown.classList.remove('open');
    const profileBtn = document.getElementById('profileIconBtn');
    if (profileBtn) profileBtn.classList.remove('active');

    const promptBox      = document.querySelector('.prompt-box');
    const promptRequired = document.getElementById('promptRequired');
    if (promptBox)      promptBox.classList.remove('is-invalid');
    if (promptRequired) promptRequired.hidden = true;

    if (event.persisted) {
      UI.loadGalaxy();
    }
  });

  /* ========== API BASE (used only for builder redirect URLs) ========== */
  function getApiBase() {
    const override = new URLSearchParams(window.location.search).get('api');
    return override ? override.replace(/\/$/, '') : '';
  }

  function getApiSuffix() {
    const override = new URLSearchParams(window.location.search).get('api');
    return override ? '&api=' + encodeURIComponent(override) : '';
  }

  /* ========== UI CONTROLLER ========== */
  const UI = {
    elements: {
      promptInput:    document.getElementById('promptInput'),
      promptBtn:      document.querySelector('.prompt-btn'),
      promptBox:      document.querySelector('.prompt-box'),
      promptRequired: document.getElementById('promptRequired'),
      galaxyGrid:     document.getElementById('galaxyGrid'),
      galaxyEmpty:    document.getElementById('galaxyEmpty'),
    },

    init() {
      this.elements.promptBtn.addEventListener('click', () => this.handleGenerate());
      this.elements.promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.handleGenerate(); }
      });
      this.elements.promptInput.addEventListener('input', () => this.clearValidation());

      if (window.Auth && Auth.isAuthenticated && Auth.isAuthenticated()) {
        this.loadGalaxy();
      }
    },

    async handleGenerate() {
      if (!window.Auth || !Auth.isAuthenticated()) {
        Auth.open('Login');
        return;
      }

      const prompt = this.elements.promptInput.value.trim();

      if (!prompt) { this.showValidation('Required'); return; }
      if (prompt.length < 10) { this.showValidation('More details needed'); return; }

      try {
        const _userId = (window.Auth && Auth.getUser()) ? String(Auth.getUser().id) : 'anon';
        localStorage.setItem('nebulux_prompt_' + _userId, prompt);
      } catch (e) {}

      try {
        const filesToSend = [];

        const refFiles = window.ReferenceFiles ? window.ReferenceFiles.get() : [];
        for (const f of refFiles) {
          if (!f.dataUrl) continue;
          let dataToStore = f.dataUrl;
          if (f.type && f.type.startsWith('image/') && f.dataUrl.length > 200 * 1024) {
            try {
              await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                  const MAX = 512;
                  const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
                  const canvas = document.createElement('canvas');
                  canvas.width = Math.round(img.width * ratio);
                  canvas.height = Math.round(img.height * ratio);
                  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                  dataToStore = canvas.toDataURL('image/jpeg', 0.65);
                  f.type = 'image/jpeg';
                  resolve();
                };
                img.onerror = resolve;
                img.src = f.dataUrl;
              });
            } catch(e) {}
          }
          filesToSend.push({
            name: f.name || 'reference',
            type: f.type || 'application/octet-stream',
            data: dataToStore,
          });
        }

        if (filesToSend.length > 0) {
          sessionStorage.setItem('nebulux_files', JSON.stringify(filesToSend));
        } else {
          sessionStorage.removeItem('nebulux_files');
        }
      } catch (e) {
        console.warn('[Nebulux] Failed to store files for builder:', e);
      }

      if (window.ReferenceFiles) window.ReferenceFiles.clear();

      const apiSuffix = getApiSuffix();
      try {
        sessionStorage.setItem('nebulux_pending_prompt', prompt);
      } catch(e) {}
      window.location.href = '/builder/?from_session=1' + apiSuffix;
    },

    showValidation(message) {
      this.elements.promptRequired.textContent = message;
      this.elements.promptRequired.hidden = false;
      this.elements.promptBox.classList.add('is-invalid');
      this.elements.promptInput.focus();
    },

    clearValidation() {
      this.elements.promptBox.classList.remove('is-invalid');
      this.elements.promptRequired.hidden = true;
    },

    _loaded:      false,
    PAGE_SIZE:    8,
    _currentPage: 1,
    _totalCount:  0,

    async loadGalaxy() {
      if (!window.Auth || !Auth.isAuthenticated()) {
        this._renderEmpty();
        this._loaded = false;
        return;
      }

      if (!Auth.getUser || !Auth.getUser()) {
        console.warn('[Nebulux] loadGalaxy: user not yet loaded, waiting...');
        await new Promise(resolve => {
          const onAuth = () => { document.removeEventListener('auth:login', onAuth); resolve(); };
          document.addEventListener('auth:login', onAuth, { once: true });
          setTimeout(resolve, 3000);
        });
      }

      const localProjects = this._getLocalProjects()
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
        .slice(0, this.PAGE_SIZE);

      if (localProjects.length > 0) {
        this._buildCards(localProjects);
      } else {
        this._renderEmpty();
      }

      await this._fetchPage(1);
    },

    async _fetchPage(page) {
      const offset = (page - 1) * this.PAGE_SIZE;
      try {
        const data = await API.get(`/websites/?limit=${this.PAGE_SIZE}&offset=${offset}`);

        this._totalCount  = data.count  || 0;
        this._currentPage = page;

        const apiProjects = (data.results || []).map(p => ({
          id:              p.id,
          apiId:           p.id,
          name:            p.prompt_preview || 'Untitled',
          prompt:          p.prompt_preview || '',
          createdAt:       new Date(p.created_at).getTime(),
          updatedAt:       new Date(p.created_at).getTime(),
          previewImageUrl: p.preview_image_url || null,
          _api:            true,
        }));

        let projects = apiProjects;
        if (page === 1) {
          const local     = this._getLocalProjects();
          const apiIds    = new Set(apiProjects.map(p => String(p.id)));
          const localOnly = local
            .filter(p => !p.apiId && !apiIds.has(String(p.id)))
            .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
          if (localOnly.length) {
            projects = [...localOnly, ...apiProjects].slice(0, this.PAGE_SIZE);
            this._totalCount += localOnly.length;
          }
        }

        if (projects.length > 0) {
          this._buildCards(projects);
        } else {
          this._renderEmpty();
          this._clearPagination();
        }
      } catch (err) {
        console.warn('[Nebulux] Could not load projects from API:', err.status ?? err.message ?? err);
      }
    },

    _renderEmpty() {
      this.elements.galaxyEmpty.style.display = '';
      this.elements.galaxyGrid.style.display  = 'none';
      this._clearPagination();
    },

    _userNs() {
      const user = window.Auth && window.Auth.getUser && window.Auth.getUser();
      return user && user.id ? String(user.id) : 'anon';
    },

    _getLocalProjects() {
      try {
        const raw = localStorage.getItem('nebulux_projects_' + this._userNs());
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
      return [];
    },

    _buildCards(projects) {
      if (!projects || projects.length === 0) { this._renderEmpty(); return; }

      this.elements.galaxyEmpty.style.display = 'none';
      this.elements.galaxyGrid.style.display  = '';
      this.elements.galaxyGrid.innerHTML = '';

      const apiSuffix = getApiSuffix();
      const _ns       = this._userNs();

      projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'showcase-card galaxy-card';
        card.dataset.projectId = String(project.id);
        const date    = new Date(project.updatedAt || project.createdAt || Date.now());
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const safeName = document.createElement('span');
        safeName.textContent = (project.name || 'Untitled').replace(/\[.*?\]/g, '').trim().slice(0, 60) || 'Untitled';
        const safePrompt = document.createElement('span');
        safePrompt.textContent = (project.prompt || '').substring(0, 80);

        const previewUrl = project.previewImageUrl || null;

        card.innerHTML = `
          <button class="galaxy-card-delete" title="Delete project" aria-label="Delete project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
          <div class="galaxy-card-preview">
            ${previewUrl
              ? `<img class="galaxy-card-thumb" src="${previewUrl}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
              : `<div class="galaxy-card-placeholder"><svg width="28" height="28" fill="none" stroke="rgba(139,92,246,0.35)" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>`}
          </div>
          <div class="galaxy-card-info">
            <h3>${safeName.innerHTML}</h3>
            <p>${safePrompt.innerHTML}${(project.prompt || '').length > 80 ? '...' : ''}</p>
            <div class="galaxy-card-meta"><span class="galaxy-card-date">${dateStr}</span></div>
          </div>`;

        card.querySelector('.galaxy-card-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          const displayName = (project.name || 'Untitled').replace(/\[.*?\]/g, '').trim().slice(0, 60) || 'Untitled';
          ConfirmDelete.show(project.id, displayName);
        });

        card.addEventListener('click', () => {
          const navId = (project.apiId != null) ? project.apiId : project.id;
          window.location.href = '/builder/?project=' + encodeURIComponent(navId) + apiSuffix;
        });

        this.elements.galaxyGrid.appendChild(card);
      });

      this.elements.galaxyGrid.querySelectorAll('.galaxy-card').forEach((c, i) => {
        c.style.opacity    = '0';
        c.style.transform  = 'translateY(40px)';
        c.style.transition = `all 0.6s ease ${i * 0.1}s`;
        _galaxyObserver.observe(c);
      });

      const pages = Math.ceil(this._totalCount / this.PAGE_SIZE);
      this._renderPagination(this._currentPage, pages);
    },

    _renderPagination(page, pages) {
      let pag = document.getElementById('galaxyPagination');
      if (!pag) {
        pag = document.createElement('div');
        pag.id = 'galaxyPagination';
        pag.className = 'galaxy-pagination';
        this.elements.galaxyGrid.parentNode.insertBefore(pag, this.elements.galaxyGrid.nextSibling);
      }

      if (pages <= 1) { pag.style.display = 'none'; return; }
      pag.style.display = '';

      pag.innerHTML = `
        <button class="gal-pag-btn" id="galPagPrev" aria-label="Previous page" ${page <= 1 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span class="gal-pag-info">
          <span class="gal-pag-current">${page}</span>
          <span class="gal-pag-sep">of</span>
          <span class="gal-pag-total">${pages}</span>
        </span>
        <button class="gal-pag-btn" id="galPagNext" aria-label="Next page" ${page >= pages ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>`;

      pag.querySelector('#galPagPrev').addEventListener('click', () => {
        if (this._currentPage > 1) {
          this._fetchPage(this._currentPage - 1);
          this.elements.galaxyGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      pag.querySelector('#galPagNext').addEventListener('click', () => {
        if (this._currentPage < pages) {
          this._fetchPage(this._currentPage + 1);
          this.elements.galaxyGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    },

    _clearPagination() {
      const pag = document.getElementById('galaxyPagination');
      if (pag) pag.style.display = 'none';
    },
  };

  /* ========== INTERSECTION OBSERVER — galaxy cards ========== */
  const _galaxyObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity   = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  /* ========== CONFIRM DELETE ========== */
  const ConfirmDelete = {
    modal:         document.getElementById('confirmDeleteModal'),
    projectNameEl: document.getElementById('confirmProjectName'),
    deleteBtn:     document.getElementById('confirmDeleteBtn'),
    cancelBtn:     document.getElementById('confirmCancelBtn'),
    pendingId:     null,

    init() {
      this.cancelBtn.addEventListener('click', () => this.hide());
      this.deleteBtn.addEventListener('click', () => this.confirm());
      this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.hide(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    },

    show(id, name) {
      this.pendingId = id;
      this.projectNameEl.textContent = name;
      this.modal.classList.add('active');
      this.deleteBtn.focus();
    },

    hide() {
      this.modal.classList.remove('active');
      this.pendingId = null;
    },

    async confirm() {
      if (this.pendingId === null) return;
      const id = this.pendingId;

      const card = UI.elements.galaxyGrid.querySelector(`.galaxy-card[data-project-id="${id}"]`);
      if (card) {
        card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(0.95)';
      }

      this.hide();

      try {
        const _ns = (window.Auth && window.Auth.getUser && window.Auth.getUser()?.id) || 'anon';
        let projects = JSON.parse(localStorage.getItem('nebulux_projects_' + _ns) || '[]');
        if (!Array.isArray(projects)) projects = [];
        localStorage.setItem('nebulux_projects_' + _ns, JSON.stringify(
          projects.filter(p => String(p.id) !== String(id) && String(p.apiId) !== String(id))
        ));
        localStorage.removeItem('nebulux_project_' + _ns + '_' + id);
        localStorage.removeItem('nebulux_chat_'    + _ns + '_' + id);
        localStorage.removeItem('nebulux_project_' + id);
        localStorage.removeItem('nebulux_chat_'    + id);
        localStorage.removeItem('nebulux_project');
      } catch {}

      setTimeout(async () => {
        UI._totalCount = Math.max(0, UI._totalCount - 1);
        const pages      = Math.ceil(UI._totalCount / UI.PAGE_SIZE);
        const targetPage = Math.min(UI._currentPage, Math.max(1, pages));
        if (UI._totalCount === 0) {
          UI._renderEmpty();
        } else {
          await UI._fetchPage(targetPage);
        }
      }, 300);

      if (Auth.isAuthenticated()) {
        try {
          await API.del(`/websites/${id}/delete/`);
        } catch (err) {
          console.warn('[Nebulux] Delete API failed:', err.status ?? err.message ?? err);
        }
      }
    },
  };

  ConfirmDelete.init();
  UI.init();

  /* ========== AUTH EVENT HANDLERS ========== */
  function _onAuthLogin()  { Profile.refresh(); UI.loadGalaxy(); }
  function _onAuthLogout() { Profile.refresh(); UI._renderEmpty(); }
  window.addEventListener('auth:login',    _onAuthLogin);
  window.addEventListener('auth:logout',   _onAuthLogout);
  document.addEventListener('auth:login',  _onAuthLogin);
  document.addEventListener('auth:logout', _onAuthLogout);

  /* ========== PROFILE SYSTEM ========== */
  const Profile = {
    isDropdownOpen: false,
    isSignoutOpen:  false,

    profileBtn:       document.getElementById('profileIconBtn'),
    dropdown:         document.getElementById('profileDropdown'),
    dropdownPlanCard: document.getElementById('dropdownPlanCard'),

    init() {
      const { profileBtn, dropdown } = this;

      profileBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleDropdown(); });
      document.addEventListener('click', (e) => {
        if (this.isDropdownOpen && !dropdown.contains(e.target) && !profileBtn.contains(e.target)) {
          this.toggleDropdown(false);
        }
      });

      const signoutOverlay   = document.getElementById('signoutConfirm');
      const signoutCancelBtn = document.getElementById('signoutCancelBtn');
      const signoutGoBtn     = document.getElementById('signoutGoBtn');
      const dropdownSignoutBtn = document.getElementById('dropdownSignoutBtn');

      const openSignout  = () => { this.toggleDropdown(false); signoutOverlay?.classList.add('open'); };
      const closeSignout = () => signoutOverlay?.classList.remove('open');

      dropdownSignoutBtn?.addEventListener('click', openSignout);
      signoutCancelBtn?.addEventListener('click', closeSignout);
      signoutOverlay?.addEventListener('click', (e) => { if (e.target === signoutOverlay) closeSignout(); });

      signoutGoBtn?.addEventListener('click', async () => {
        closeSignout();
        if (window.Auth) await Auth.logout();
        window.location.reload();
      });

      this.refresh();
    },

    toggleDropdown(force) {
      this.isDropdownOpen = force !== undefined ? force : !this.isDropdownOpen;
      this.dropdown.classList.toggle('open', this.isDropdownOpen);
      this.profileBtn.classList.toggle('active', this.isDropdownOpen);
    },

    refresh() {
      const user     = window.Auth ? Auth.getUser() : null;
      const isAuthed = window.Auth ? Auth.isAuthenticated() : false;

      const userNameEl  = document.getElementById('dropdownUserName');
      const userEmailEl = document.getElementById('dropdownUserEmail');
      if (userNameEl)  userNameEl.textContent  = user?.name || user?.email?.split('@')[0] || '—';
      if (userEmailEl) userEmailEl.textContent = user?.email || '';

      const planNameEl   = document.querySelector('.dropdown-plan-name');
      const planTokensEl = document.querySelector('.dropdown-plan-tokens');
      if (isAuthed && user) {
        const planLabel = user.plan ? (user.plan.charAt(0).toUpperCase() + user.plan.slice(1)) : 'Free';
        if (planNameEl)   planNameEl.textContent   = planLabel;
        if (planTokensEl) planTokensEl.textContent = `Credits: ${(user.credits ?? 0).toLocaleString()} / ${(user.monthly_credit_limit ?? 0).toLocaleString()}`;
      } else {
        if (planNameEl)   planNameEl.textContent   = '—';
        if (planTokensEl) planTokensEl.textContent = '';
      }

      const subPlanEl    = document.getElementById('subCurrentPlan');
      const subCreditsEl = document.getElementById('subCreditsValue');
      if (isAuthed && user) {
        const planLabel = user.plan ? (user.plan.charAt(0).toUpperCase() + user.plan.slice(1)) : 'Free';
        if (subPlanEl)    subPlanEl.textContent    = planLabel;
        if (subCreditsEl) subCreditsEl.textContent = `${(user.credits ?? 0).toLocaleString()} / ${(user.monthly_credit_limit ?? 0).toLocaleString()}`;
      }

    },
  };

  Profile.init();

  /* ========== AUTO-RESIZE TEXTAREA ========== */
  const textarea = document.querySelector('.prompt-input');
  if (textarea) {
    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });
  }

  /* ========== PLANET MOVEMENT ========== */
  const planet = document.getElementById('giantPlanet');
  if (planet) {
    let lastMovement = Date.now();
    setInterval(() => {
      if (Date.now() - lastMovement >= 8000) {
        planet.classList.add('planet-move');
        setTimeout(() => planet.classList.remove('planet-move'), 2500);
        lastMovement = Date.now();
      }
    }, 1000);
  }

  /* ========== SCROLL-BASED PLANET TRANSITION ========== */
  const giantPlanetEl  = document.getElementById('giantPlanet');
  const secondPlanetEl = document.getElementById('secondPlanet');
  window._planetTransitionProgress = 0;

  function handlePlanetTransition() {
    const s = window.scrollY, h = window.innerHeight;
    const raw = Math.max(0, Math.min(1, (s - h * 0.1) / (h * 2 - h * 0.1)));
    const t   = raw * raw * (3 - 2 * raw);
    window._planetTransitionProgress = t;

    if (giantPlanetEl) {
      if (raw === 0) {
        giantPlanetEl.style.transform  = '';
        giantPlanetEl.style.opacity    = '';
        giantPlanetEl.style.transition = '';
      } else {
        giantPlanetEl.style.transition = 'none';
        giantPlanetEl.style.transform  = `translateY(-50%) translateX(${(t * 160).toFixed(2)}%)`;
        giantPlanetEl.style.opacity    = (0.84 * (1 - t)).toFixed(3);
      }
    }

    if (secondPlanetEl) {
      const isMobile = window.innerWidth <= 768;
      const tx       = -20 + (isMobile ? 15 : 20) * t;
      const opacity  = 0.84 * t;
      secondPlanetEl._baseOpacity = opacity;
      secondPlanetEl._baseTx      = tx;
      secondPlanetEl.style.transition = 'none';
      secondPlanetEl.style.transform  = `translateY(-50%) translateX(${tx.toFixed(2)}%)`;
      secondPlanetEl.style.opacity    = opacity.toFixed(3);
    }

    document.body.classList.toggle('planet-transition-active', t > 0.5);
  }

  window.addEventListener('scroll', handlePlanetTransition, { passive: true });
  window.addEventListener('load',   handlePlanetTransition);
  window.addEventListener('resize', handlePlanetTransition);

  /* ========== PROMPT CHIPS ========== */
  const promptData = {
    travel:   'Design a travel planning app with an immersive interface. Homepage: hero search with destination autocomplete, date picker, and traveler count selector. Features: interactive map with pins for saved destinations, personalized itinerary builder with drag-and-drop timeline, hotel and flight comparison cards with filters, real-time weather and currency conversion, photo gallery from other travelers. Use calming blues and greens with warm sunset accent colors, smooth transitions, and modern card-based layouts.',
    learning: 'Create an educational learning platform with intuitive navigation. Main dashboard: progress tracking with visual milestones, course cards with completion percentages, upcoming live sessions calendar, personalized recommendations. Course page: video player with bookmark and speed controls, interactive quizzes with instant feedback, discussion forum, downloadable resources. Features: gamification with achievement badges, study streak counter, peer collaboration spaces. Use soft purple and teal accents with clean typography.',
    finance:  'Build a modern finance management app with clear data visualization. Dashboard: account balance overview, spending breakdown with interactive pie charts, recent transactions list with category icons, savings goals progress bars. Features: budget planner with customizable categories, bill reminders with notification badges, investment portfolio tracker with performance graphs. Use professional dark theme with green accents for gains, red for expenses, and sophisticated graphs.',
    shopping: 'Design a premium shopping app with seamless user experience. Homepage: curated product carousel, category tiles with lifestyle imagery, personalized recommendations, flash deals with countdown timers. Product page: high-res image gallery with zoom, size and color selectors, customer reviews with photos, similar items carousel. Features: wishlist, smart search with filters, order tracking with delivery map. Use elegant black and white with gold accents.',
  };

  const promptInputEl = document.querySelector('.prompt-input');
  document.querySelectorAll('.prompt-chip[data-prompt]').forEach(chip => {
    chip.addEventListener('click', () => {
      UI.clearValidation();
      const prompt = promptData[chip.dataset.prompt];
      if (prompt && promptInputEl) {
        promptInputEl.value = '';
        let i = 0;
        const iv = setInterval(() => {
          if (i < prompt.length) {
            promptInputEl.value += prompt[i++];
            promptInputEl.style.height = 'auto';
            promptInputEl.style.height = Math.min(promptInputEl.scrollHeight, 300) + 'px';
          } else { clearInterval(iv); promptInputEl.focus(); }
        }, 3);
      }
    });
  });

  /* ========== INTERSECTION OBSERVER (static content) ========== */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.style.opacity = '1'; e.target.style.transform = 'translateY(0)'; }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.showcase-label, .showcase h2').forEach(el => {
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(30px)';
    el.style.transition = 'all 0.8s ease';
    obs.observe(el);
  });

  /* ========== REFERENCE FILE ATTACH ========== */
  (function () {
    const referenceBtn   = document.getElementById('referenceBtn');
    const referenceInput = document.getElementById('referenceFileInput');
    const refPreview     = document.getElementById('referencePreview');
    const refBtnLabel    = document.getElementById('referenceBtnLabel');
    if (!referenceBtn || !referenceInput) return;

    let attachedRefFiles = [];

    function _restoreFilesFromStorage() {
      try {
        if (!window.Auth || !Auth.getUser()) return;
        const _userId = String(Auth.getUser().id);
        const stored = localStorage.getItem('nebulux_attachments_' + _userId);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            attachedRefFiles = parsed.slice(0, 3);
            renderRefPreviews();
          }
        }
      } catch (e) {}
    }
    document.addEventListener('auth:login', _restoreFilesFromStorage, { once: true });
    if (window.Auth && Auth.getUser()) _restoreFilesFromStorage();

    function renderRefPreviews() {
      refPreview.innerHTML = '';
      if (!attachedRefFiles.length) {
        refBtnLabel.textContent = 'Attach';
        refPreview.classList.remove('visible');
        referenceBtn.disabled = false;
        referenceBtn.title = 'Attach file';
        return;
      }
      refBtnLabel.textContent = 'Attach';
      referenceBtn.disabled = attachedRefFiles.length >= 3;
      referenceBtn.title = attachedRefFiles.length >= 3 ? 'Maximum 3 files' : 'Attach file';
      refPreview.classList.add('visible');

      attachedRefFiles.forEach((file, idx) => {
        const wrap = document.createElement('div');
        wrap.className = 'file-square-card';
        wrap.title = file.name;

        if (file.dataUrl && file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = file.dataUrl;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;';
          wrap.appendChild(img);
        } else {
          const ext = (file.name.split('.').pop() || 'file').toUpperCase();
          const extBadge = document.createElement('div');
          extBadge.className = 'file-square-ext';
          extBadge.textContent = ext;
          wrap.appendChild(extBadge);

          if (file.text) {
            const preview = document.createElement('div');
            preview.className = 'file-square-text';
            preview.textContent = file.text.slice(0, 120);
            wrap.appendChild(preview);
          }
        }

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'file-square-remove';
        removeBtn.innerHTML = '×';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          attachedRefFiles.splice(idx, 1);
          syncRefToStorage();
          renderRefPreviews();
        });
        wrap.appendChild(removeBtn);

        refPreview.appendChild(wrap);
      });
    }

    function syncRefToStorage() {
      try {
        const _userId = (window.Auth && Auth.getUser()) ? String(Auth.getUser().id) : 'anon';
        localStorage.setItem('nebulux_attachments_' + _userId, JSON.stringify(
          attachedRefFiles.map(f => ({ name: f.name, type: f.type, size: f.size, dataUrl: f.dataUrl }))
        ));
      } catch {}
    }

    referenceBtn.addEventListener('click', () => referenceInput.click());
    referenceInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      let pending = files.length;
      files.forEach(file => {
        if (attachedRefFiles.length >= 3) { pending--; if (pending === 0) { syncRefToStorage(); renderRefPreviews(); } return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const isImage = file.type.startsWith('image/');
          const entry = { name: file.name, type: file.type, size: file.size, dataUrl: ev.target.result };
          if (!isImage) {
            const textReader = new FileReader();
            textReader.onload = (te) => {
              entry.text = te.target.result.slice(0, 300);
              attachedRefFiles.push(entry);
              pending--;
              if (pending === 0) { syncRefToStorage(); renderRefPreviews(); }
            };
            textReader.onerror = () => {
              attachedRefFiles.push(entry);
              pending--;
              if (pending === 0) { syncRefToStorage(); renderRefPreviews(); }
            };
            textReader.readAsText(file);
          } else {
            attachedRefFiles.push(entry);
            pending--;
            if (pending === 0) { syncRefToStorage(); renderRefPreviews(); }
          }
        };
        reader.readAsDataURL(file);
      });
      referenceInput.value = '';
    });

    window._refUpdateLabel = () => { attachedRefFiles = []; renderRefPreviews(); };
    window._getRefFilesCount = () => attachedRefFiles.length;
    window.ReferenceFiles = {
      get:   () => [...attachedRefFiles],
      clear: () => { attachedRefFiles = []; renderRefPreviews(); },
    };
  })();

  /* ========== SECOND PLANET / FOOTER INTERACTION ========== */
  (function () {
    const secondPlanet = document.getElementById('secondPlanet');
    const footer       = document.querySelector('.site-footer');
    if (!secondPlanet || !footer) return;

    const MARGIN = 16, LERP = 0.10;
    let currentNudge = 0, rafId = null;

    function getTarget() {
      const vh = window.innerHeight;
      const naturalBottom = vh * 0.85 + secondPlanet.offsetHeight / 2;
      return Math.max(0, naturalBottom - (footer.getBoundingClientRect().top - MARGIN));
    }

    function commit() {
      const baseTx      = secondPlanet._baseTx      ?? -20;
      const baseOpacity = secondPlanet._baseOpacity  ?? 0;
      const footerTop   = footer.getBoundingClientRect().top;
      const scrolledIn  = window.innerHeight - footerTop;
      if (scrolledIn <= 0 && currentNudge < 0.5) return;
      secondPlanet.style.transition = 'none';
      if (currentNudge >= 0.5)
        secondPlanet.style.transform = `translateY(calc(-50% - ${currentNudge.toFixed(2)}px)) translateX(${baseTx.toFixed(2)}%)`;
      const fadeStart = window.innerHeight * 0.15, fadeEnd = window.innerHeight * 0.65;
      let opacity = baseOpacity;
      if (scrolledIn > fadeStart) {
        const p     = Math.min(1, (scrolledIn - fadeStart) / (fadeEnd - fadeStart));
        const eased = p * p * (3 - 2 * p);
        opacity     = baseOpacity * (1 - eased);
      }
      secondPlanet.style.opacity = opacity.toFixed(3);
    }

    function animate() {
      rafId = null;
      const target = getTarget(), diff = target - currentNudge;
      if (target > currentNudge) { currentNudge = target; }
      else {
        currentNudge += diff * LERP;
        if (Math.abs(diff) > 0.5) rafId = requestAnimationFrame(animate);
        else currentNudge = target;
      }
      commit();
    }

    function onScroll() { if (!rafId) rafId = requestAnimationFrame(animate); }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  })();

  /* ========== HERO SNAP ON SCROLL UP ========== */
  (function () {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    let lastScrollY = window.scrollY;
    let snapQueued  = false;

    function snapToTop() {
      snapQueued = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    window.addEventListener('scroll', function () {
      const currentScrollY = window.scrollY;
      const scrollingUp    = currentScrollY < lastScrollY;
      lastScrollY = currentScrollY;

      if (!scrollingUp || currentScrollY === 0) return;

      const heroRect  = hero.getBoundingClientRect();
      const vpHeight  = window.innerHeight;

      const visibleTop    = Math.max(0, heroRect.top);
      const visibleBottom = Math.min(vpHeight, heroRect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const heroHeight    = heroRect.height;
      const visibleRatio  = heroHeight > 0 ? visibleHeight / heroHeight : 0;

      if (visibleRatio >= 0.60 && !snapQueued) {
        snapQueued = true;
        setTimeout(snapToTop, 80);
      }
    }, { passive: true });
  })();

  /* ========== AUTH GATE FOR GENERATE BUTTON ========== */
  (function () {
    function getPromptValue() {
      const ta = document.getElementById('promptInput');
      return ta ? ta.value.trim() : '';
    }
    function navigateToBuilder(prompt) {
      if (prompt) {
        try { localStorage.setItem('nebulux_prompt', prompt); } catch (e) {}
      }
      window.location.href = '/builder/' + (prompt ? '?prompt=' + encodeURIComponent(prompt) : '');
    }
    document.addEventListener('click', function interceptGenerate(e) {
      const btn = e.target.closest('.prompt-btn');
      if (!btn) return;
      if (window.Auth && window.Auth.isAuthenticated()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const prompt = getPromptValue();
      if (window.Auth) window.Auth.open('Login');
      document.addEventListener('auth:login', function onLogin() {
        navigateToBuilder(prompt);
      }, { once: true });
    }, true);
  })();

  /* ========== PREVENT TEXT SELECTION ON NON-INPUT ELEMENTS ========== */
  document.addEventListener('selectstart', function(e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });
  document.addEventListener('contextmenu', function(e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  });
}

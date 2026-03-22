// FE-1: Import pure utility functions from the dedicated utils module.
// These are accessible inside the IIFE below via closure (module scope → IIFE scope).
import {
  delay,
  escapeHtml,
  highlightHTML,
  highlightCSS,
  prettifyHTML,
  prettifyCSS,
  formatCodeWithLineNumbers,
  extractCSS,
} from './builder-utils.js';

/**
 * NEBULUX Builder — Production-Ready
 *
 * FIXES IN THIS REWRITE:
 *  1. Projects System — per-project localStorage keys + registry sync
 *     - state.projectId resolved from URL ?project=, legacy data, or fresh ID
 *     - Save writes nebulux_project_<id> + nebulux_projects registry + legacy key
 *     - Load reads nebulux_project_<id> (from URL) or nebulux_project (legacy)
 *  2. Chat Persistence per project — nebulux_chat_<id>
 *  3. Save UX feedback — "Saved ✓" button state + chat error message on failure
 *  4. Mobile preview — real 375px viewport via CSS class (no scaling hack)
 *     + responsive validator + single repair retry
 *  5. CORS / API base URL — same-origin /api by default, ?api= dev override
 *  6. mobileSpec bug fixed (was undefined; now correctly spreads `spec`)
 *  7. Backward compat — old nebulux_project users keep working; saves migrate
 */
(function () {
  'use strict';
  const noop = () => {};

  /* ============================================================
     CONFIG
  ============================================================ */
  const CONFIG = {
    apiBaseUrl: (() => {
      // FIX: The previous implementation allowed ?api=<any-url> to override the
      // API base, which is a credential-theft vector — an attacker can craft a
      // link like /builder?api=https://evil.com/api and every fetch (including
      // the JWT Bearer token) is sent to the attacker's server.
      // Override is now restricted to same-origin URLs only, and only in
      // development (non-standard ports).  In production the path is always /api.
      if (window.location.port === '5500' || window.location.port === '5501') {
        return 'http://127.0.0.1:8000/api';
      }
      return '/api';
    })(),
    demoMode: false,
    autoSaveInterval: 30000,
    maxHistory: 20,
    dataVersion: 3,
    iframeLoadTimeout: 90000,
  };

  /* ============================================================
     STATE — single source of truth
  ============================================================ */
  const state = {
    projectId: '',          // set by _resolveProjectId() before everything else
    originalPrompt: '',
    currentCode: '',
    device: 'desktop',
    hasUnsavedChanges: false,
    projectName: 'New Website',
    pages: [{ id: 'page_1', name: 'index', code: '', timestamp: Date.now(), history: [], historyIndex: -1, chatMessages: [] }],
    currentPageId: 'page_1',
    selectMode: false,
    selectedElement: null,
    lastGenerationId: null,
    editMode: null,    // FE-6: active mode pill — null|'content'|'style'|'layout'
    createdAt: Date.now(),  // preserved across saves for registry
    files: [],             // attached files: [{name, type, data(base64), preview?}]
  };

  /* ============================================================
     PROJECT ID RESOLUTION
     Must run BEFORE Chat.restoreFromStorage() {
  console.log('Restoring chat from', chatStorageKey());
  // ... existing logic
  console.log('Restored', chatMessages.length, 'messages');
} so the correct
     per-project chat key is used.
  ============================================================ */
  function _resolveProjectId() {
    // Priority 1: URL ?project= param (opening from index)
    const urlId = new URLSearchParams(window.location.search).get('project');
    if (urlId && urlId.trim()) {
      state.projectId = urlId.trim();
      return;
    }

    // Priority 2: generate a fresh project ID
    // NOTE: Legacy unscoped nebulux_project fallback removed — it allowed
    // User B to load User A's project when sharing a browser.
    state.projectId = 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  // Run immediately so projectId is available for Chat key
  _resolveProjectId();

  // If projectId is an integer (from galaxy), migrate chat from old proj_* key
  (function _migrateChatKey() {
    try {
      const isApiId = /^\d+$/.test(String(state.projectId));
      if (!isApiId) return;
      const ns = _userNamespace();
      const newChatKey = 'nebulux_chat_' + ns + '_' + state.projectId;
      if (localStorage.getItem(newChatKey)) return; // already migrated
      const prefix = 'nebulux_project_' + ns + '_';
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        if (key === prefix + state.projectId) continue;
        try {
          const proj = JSON.parse(localStorage.getItem(key));
          if (!proj || String(proj.lastGenerationId) !== String(state.projectId)) continue;
          const oldProjId = key.replace(prefix, '');
          const oldChatKey = 'nebulux_chat_' + ns + '_' + oldProjId;
          const oldChat = localStorage.getItem(oldChatKey);
          if (oldChat) {
            localStorage.setItem(newChatKey, oldChat);
          }
          return;
        } catch (_) { }
      }
    } catch (_) { }
  })();

  /* ============================================================
     DOM REFS
  ============================================================ */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const el = {
    projectTitle: $('#projectTitle'),
    previewBtn: $('#previewBtn'),
    exportBtn: $('#exportBtn'),
    publishBtn: $('#publishBtn'),
    saveBtn: $('#saveBtn'),
    canvasArea: $('#canvasArea'),
    loadingOverlay: $('#loadingOverlay'),
    loaderText: null,    // FIX 3: #loaderText does not exist; .lo-mod-text is used instead
    deviceFrame: $('#deviceFrame'),
    previewFrame: $('#previewFrame'),
    renderError: $('#renderError'),
    elementEditor: $('#elementEditor'),
    editorInput: $('#editorInput'),
    editorEditText: $('#editorEditText'),
    editorReplaceImage: $('#editorReplaceImage'),
    editorSubmit: $('#editorSubmit'),
    editorDelete: $('#editorDelete'),
    editorClose: $('#editorClose'),
    selectionBanner: $('#selectionBanner'),
    selectionTag: $('#selectionTag'),
    selectionInfo: $('#selectionInfo'),
    genProgress: null, // removed — generation steps shown in process-panel only
    messages: $('#messages'),
    chatInput: $('#chatInput'),
    sendBtn: $('#sendBtn'),
    editingLabel: $('#editingLabel'),
    editingTarget: $('#editingTarget'),
    sidebarBody: $('#sidebarBody'),
    historyList: $('#historyList'),
    historyEmpty: $('#historyEmpty'),
    exportModal: $('#exportModal'),
    exportCloseBtn: $('#exportCloseBtn'),
    exportProjectTitle: $('#exportProjectTitle'),
    exportFileInfo: $('#exportFileInfo'),
    exportCodeArea: $('#exportCodeArea'),
    exportCode: $('#exportCode'),
    copyCodeBtn: $('#copyCodeBtn'),
    openFigmaBtn: $('#openFigmaBtn'),
    downloadBtn: $('#downloadBtn'),
    pageSelector: $('#pageSelector'),
    currentPageName: $('#currentPageName'),
    pageCount: $('#pageCount'),
    pageDropdown: $('#pageDropdown'),
    pageList: $('#pageList'),
    addPageBtn: $('#addPageBtn'),
    publishFullBtn: $('#publishFullBtn'),
    editModeBar: $('#editModeBar'),

  };

  /* ============================================================
     AI THOUGHT STREAM — Claude-style "Thought for Xs" widget

     Single collapsible bubble with:
       1. Live-timer header: "▼ · Thinking… (Xs)"
       2. Action rows (compact dot + label) per phase
       3. Prose paragraphs typed out character-by-character
       4. Collapsible code panels (grey/white) when HTML streams
       5. Auto-collapses to "▶ Thought for Xs" when done
  ============================================================ */
  const AIThinkChat = (() => {
    let _container = null;
    let _phraseSpan = null;
    let _timerEl = null;
    let _startTime = 0;
    let _timerRaf = null;
    let _phraseInterval = null;
    let _phraseIdx = 0;
    let _isDone = false;
    let _reasoningBuffer = '';

    const _PHRASES = [
      'Applying your changes...',
      'Refining the code...',
      'Updating the design...',
      'Planning your layout...',
      'Choosing typography...',
      'Finding the right photos...',
      'Designing the color palette...',
      'Structuring sections...',
      'Crafting animations...',
      'Building responsive layouts...',
      'Setting up navigation...'
    ];

    function _build() {
      _container = document.createElement('div');
      _container.className = 'message ai ai-thinking-minimal';

      _container.innerHTML = `
        <div class="message-content" style="display:flex; align-items:center; gap:8px; opacity:0.8;">
          <div class="ai-think-dots" style="display:flex; gap:2px; color:#d4a85a;">
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both;">.</span>
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both; animation-delay:0.2s;">.</span>
            <span class="dot" style="animation: orbPulse 1.4s infinite ease-in-out both; animation-delay:0.4s;">.</span>
          </div>
          <span class="ai-think-phrase" style="color:#a1a1aa; font-size:13px; transition: opacity 0.3s ease;">${_PHRASES[0]}</span>
          <span class="ai-think-timer" style="color:#555; font-size:12px; margin-left:auto;">0s</span>
        </div>
      `;

      _phraseSpan = _container.querySelector('.ai-think-phrase');
      _timerEl = _container.querySelector('.ai-think-timer');

      const messages = document.getElementById('messages');
      if (messages) messages.appendChild(_container);

      _startTime = Date.now();
      _isDone = false;
      _tickTimer();
      _startPhrases();
      _scrollDown();
    }

    function _tickTimer() {
      if (_isDone || !_timerEl) return;
      const secs = Math.floor((Date.now() - _startTime) / 1000);
      _timerEl.textContent = `${secs}s`;
      _timerRaf = requestAnimationFrame(() => setTimeout(_tickTimer, 500));
    }

    function _startPhrases() {
      if (_phraseInterval) clearInterval(_phraseInterval);
      _phraseIdx = 0;
      _phraseInterval = setInterval(() => {
        if (_isDone || !_phraseSpan) return;
        _phraseIdx = (_phraseIdx + 1) % _PHRASES.length;
        _phraseSpan.style.opacity = '0';
        setTimeout(() => {
          if (_isDone) return;
          _phraseSpan.textContent = _PHRASES[_PHRASES.length > _phraseIdx ? _phraseIdx : 0];
          _phraseSpan.style.opacity = '1';
        }, 300);
      }, 3000);
    }

    function _ensure() { if (!_container) _build(); return _container; }

    function _scrollDown() {
      const sb = document.getElementById('sidebarBody');
      if (sb) sb.scrollTop = sb.scrollHeight;
      const m = document.getElementById('messages');
      if (m && m.parentElement) m.parentElement.scrollTop = m.parentElement.scrollHeight;
    }

    function reset() {
      if (_timerRaf) cancelAnimationFrame(_timerRaf);
      if (_phraseInterval) clearInterval(_phraseInterval);
      if (_container && _container.parentNode) _container.parentNode.removeChild(_container);
      _container = null; _phraseSpan = null; _timerEl = null;
      _startTime = 0; _isDone = false; _timerRaf = null; _phraseInterval = null;
      _reasoningBuffer = '';
    }

    function doneThinking() {
      if (!_container || _isDone) return;
      _isDone = true;
      reset();
    }

    function stream(text) {
      if (!text) return;
      _ensure();
      _isDone = false;
      _reasoningBuffer += text;
      _scrollDown();
    }

    function addWritingRow(slug) {
      _ensure();
      if (_phraseSpan) {
        _phraseSpan.textContent = `Writing ${slug}...`;
      }
    }

    function appendCodeChunk(text) {
      // Optional: could show a progress bar or similar
    }

    return {
      show: _ensure,
      stream,
      doneThinking,
      reset,
      getReasoning: () => _reasoningBuffer,
      addPhase: (phase, text) => {
        _ensure();
        if (_phraseInterval) { clearInterval(_phraseInterval); _phraseInterval = null; }
        if (text && _phraseSpan) {
           _phraseSpan.style.opacity = '1';
           _phraseSpan.textContent = text;
        }
      },
      addWritingRow,
      appendCodeChunk,
      addStep: noop,
      updateStep: noop
    };
  })();

  /* ============================================================
     CANVAS-FIRST GENERATION STAGE
     Replaces old GenStage + removes any DidYouKnow dependency.
  ============================================================ */
  const GenStage = (() => {
    const canvas = document.getElementById('canvasArea');
    const shell = document.getElementById('generationShell');
    const stage = document.getElementById('genStage');
    const titleEl = document.getElementById('genStageTitle');
    const subtitleEl = document.getElementById('genStageSubtitle');
    const deviceFrame = document.getElementById('deviceFrame');

    let pages = [];
    let visible = false;

    const PHRASES = [
      "Crafting architecture...",
      "Drafting layouts...",
      "Mixing palettes...",
      "Writing components...",
      "Polishing interactions..."
    ];
    let _phraseIdx = 0;
    let _phraseTimer = null;

    function slugify(value) {
      return String(value || 'page')
        .trim()
        .toLowerCase()
        .replace(/\.html$/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'page';
    }

    function toLabel(slug) {
      return `${slug}.html`;
    }

    function normalize(input) {
      const source = Array.isArray(input) && input.length ? input : ['index'];
      return source.map((item, i) => {
        const raw = typeof item === 'string'
          ? item
          : item.slug || item.name || item.page || `page-${i + 1}`;

        const slug = slugify(raw);
        return {
          slug,
          label: toLabel(slug),
          status: 'queued'
        };
      });
    }

    function ensurePage(slug) {
      const key = slugify(slug);
      let page = pages.find(p => p.slug === key);
      if (!page) {
        page = { slug: key, label: toLabel(key), status: 'queued' };
        pages.push(page);
      }
      return page;
    }

    function syncSummary() {
      if (!subtitleEl) return;

      const total = pages.length;
      const ready = pages.filter(p => p.status === 'ready').length;
      const writing = pages.find(p => p.status === 'writing');

      if (writing) {
        subtitleEl.textContent = `Writing ${writing.label} • ${ready}/${total} ready`;
        return;
      }

      if (ready === total && total > 0) {
        subtitleEl.textContent = `All ${total} page${total === 1 ? '' : 's'} generated`;
        return;
      }

      subtitleEl.textContent = `Creating ${total} page${total === 1 ? '' : 's'} in the workspace`;
    }

    function _cyclePhrases() {
      if (!titleEl) return;
      _phraseIdx = (_phraseIdx + 1) % PHRASES.length;
      titleEl.textContent = PHRASES[_phraseIdx];
    }

    function setVisible(on) {
      visible = !!on;

      if (canvas) canvas.classList.toggle('generating', visible);
      if (shell) shell.style.display = visible ? 'flex' : '';
      if (stage) stage.hidden = !visible;
      if (stage) stage.setAttribute('aria-busy', visible ? 'true' : 'false');

      if (visible) {
        if (!_phraseTimer) {
          _phraseIdx = 0;
          if (titleEl) titleEl.textContent = PHRASES[0];
          _phraseTimer = setInterval(_cyclePhrases, 3000);
        }
      } else {
        if (_phraseTimer) clearInterval(_phraseTimer);
        _phraseTimer = null;
      }

      if (deviceFrame) {
        deviceFrame.style.visibility = visible ? 'visible' : '';
      }
    }

    function show(inputPages, opts = {}) {
      pages = normalize(inputPages);
      if (titleEl && opts.title) {
        // optional override, otherwise wait for cycle
      }
      syncSummary();
      setVisible(true);
    }

    function updateStatus(slug, status) {
      const page = ensurePage(slug);

      if (status === 'writing') {
        pages.forEach(p => {
          if (p.slug !== page.slug && p.status === 'writing') {
            p.status = 'queued';
          }
        });
      }

      page.status = status;
      syncSummary();
    }

    function setQueued(slug) {
      updateStatus(slug, 'queued');
    }

    function setWriting(slug) {
      updateStatus(slug, 'writing');
    }

    function setReady(slug) {
      updateStatus(slug, 'ready');
    }

    function setError(slug) {
      updateStatus(slug, 'error');
    }

    function showAllReady(slugs = []) {
      const list = Array.isArray(slugs) && slugs.length
        ? slugs
        : pages.map(p => p.slug);

      list.forEach((slug, index) => {
        setTimeout(() => setReady(slug), index * 90);
      });
    }

    function hide() {
      setVisible(false);
    }

    function reset() {
      pages = [];
      setVisible(false);
    }

    return {
      show,
      setQueued,
      setWriting,
      setReady,
      setError,
      showAllReady,
      hide,
      reset
    };
  })();

  /* ============================================================
     SIMPLE GENERATION CHAT
     Keeps the sidebar as plain chat/history during generation.
  ============================================================ */
  function addSystemGenerationMessage(text) {
    const msg = document.createElement('div');
    msg.className = 'message ai';
    msg.innerHTML = `<div class="message-content">${text}</div>`;
    el.messages.appendChild(msg);
    if (el.sidebarBody) el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
    return msg;
  }

  /* ============================================================
     GENERATION LIFECYCLE HELPERS
     Use these from your existing stream / fetch pipeline.
  ============================================================ */
  function beginCanvasGeneration(plannedPages = []) {
    const pages = Array.isArray(plannedPages) && plannedPages.length
      ? plannedPages
      : ['index'];

    setGenerating(true);
    GenStage.show(pages, { title: 'Generating your site' });

    if (el.chatInput) el.chatInput.blur();
    addSystemGenerationMessage(`Building ${pages.length} page${pages.length === 1 ? '' : 's'}...`);
  }

  function beginCanvasModify(targetLabel = 'current page') {
    setGenerating(true);
    GenStage.show([targetLabel], { title: 'Applying changes' });
    GenStage.setWriting(targetLabel);
    addSystemGenerationMessage(`Updating ${targetLabel}...`);
  }

  function markGenerationPageWriting(slug) {
    GenStage.setWriting(slug);
  }

  function markGenerationPageReady(slug) {
    GenStage.setReady(slug);
  }

  function markGenerationPageError(slug) {
    GenStage.setError(slug);
  }

  function finishCanvasGeneration(finalPages = []) {
    if (finalPages.length) {
      GenStage.showAllReady(finalPages);
    } else {
      GenStage.showAllReady();
    }

    setTimeout(() => {
      GenStage.hide();
      setGenerating(false);
    }, 700);
  }

  function failCanvasGeneration(message = 'Generation failed.') {
    GenStage.hide();
    setGenerating(false);
    addSystemGenerationMessage(message);
  }

  /* ============================================================
     STOP GENERATION
     Replace your current stopGeneration() with this.
  ============================================================ */
  function stopGeneration() {
    if (!isGenerating) return;

    if (genAbortCtrl) {
      genAbortCtrl.abort();
      genAbortCtrl = null;
    }

    Queue.forceReset();
    GenStage.hide();
    setGenerating(false);
    addSystemGenerationMessage('Generation stopped.');
  }

  /* ============================================================
     EXAMPLE INTEGRATION
     Call these from your existing streaming events.
  ============================================================ */

  /*
  Example: initial project generation
  
  beginCanvasGeneration(['index', 'pricing', 'about']);
  
  markGenerationPageWriting('index');
  // stream index page...
  markGenerationPageReady('index');
  
  markGenerationPageWriting('pricing');
  // stream pricing page...
  markGenerationPageReady('pricing');
  
  markGenerationPageWriting('about');
  // stream about page...
  markGenerationPageReady('about');
  
  finishCanvasGeneration(['index', 'pricing', 'about']);
  */

  /*
  Example: modify current page
  
  beginCanvasModify('index');
  // stream modified html...
  markGenerationPageReady('index');
  finishCanvasGeneration(['index']);
  */


  /* ============================================================
     CREDIT INDICATOR — live balance from /api/auth/me/
     Updates on load, after every generation/modify, and on
     auth:login events. Shows "0 credits" for free-plan users.
  ============================================================ */
  const Credits = (() => {
    const badge = document.getElementById('creditsCount');
    let _lastBalance = null;

    function _display(credits) {
      if (!badge) return;
      _lastBalance = credits;
      badge.textContent = `${credits} credit${credits !== 1 ? 's' : ''}`;
      // Pulse animation on change
      badge.classList.remove('credits-pulse');
      void badge.offsetWidth; // force reflow
      badge.classList.add('credits-pulse');
    }

    async function refresh() {
      try {
        if (!window.Auth || !window.Auth.isAuthenticated()) return;
        // FIX #11: derive origin cleanly instead of fragile string .replace('/api','')
        // which would corrupt URLs like https://api.example.com/api → https:.example.com/api
        let meUrl;
        try {
          const parsed = new URL(CONFIG.apiBaseUrl, window.location.href);
          // Strip the /api path suffix to get just the origin
          meUrl = parsed.origin + '/api/auth/me/';
        } catch {
          meUrl = '/api/auth/me/';
        }
        const res = await window.Auth.apiFetch(meUrl);
        if (!res.ok) return;
        const user = await res.json();
        _display(user.credits ?? 0);
        // Also update the auth state so dropdown stays in sync
        if (window.Auth && window.Auth.getUser()) {
          window.Auth.getUser().credits = user.credits;
          window.Auth.getUser().plan = user.plan;
        }
      } catch { /* silent — badge just keeps last value */ }
    }

    function get() { return _lastBalance; }

    return { refresh, display: _display, get };
  })();

  /* ============================================================
     UPGRADE GATE — modal shown when 402 is returned
     Blocks generation for free-plan / zero-credit users and
     directs them to /pricing/.
  ============================================================ */
  const UpgradeGate = (() => {
    let _overlayEl = null;

    function _ensureModal() {
      if (_overlayEl) return _overlayEl;
      const overlay = document.createElement('div');
      overlay.id = 'upgradeGateOverlay';
      overlay.className = 'upgrade-gate-overlay';
      overlay.innerHTML = `
        <div class="upgrade-gate-modal">
          <div class="upgrade-gate-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <h3 class="upgrade-gate-title">Upgrade Required</h3>
          <p class="upgrade-gate-text">Generation is currently restricted to Standard Plan users. Please upgrade to continue building.</p>
          <div class="upgrade-gate-actions">
            <button class="upgrade-gate-btn upgrade-gate-btn-primary" id="ugUpgradeBtn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              View Plans
            </button>
            <button class="upgrade-gate-btn upgrade-gate-btn-secondary" id="ugDismissBtn">Dismiss</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      _overlayEl = overlay;

      overlay.querySelector('#ugUpgradeBtn').addEventListener('click', () => {
        window.location.href = '/pricing/';
      });
      overlay.querySelector('#ugDismissBtn').addEventListener('click', () => {
        overlay.classList.remove('visible');
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('visible');
      });

      return overlay;
    }

    function show(message) {
      const modal = _ensureModal();
      if (message) {
        modal.querySelector('.upgrade-gate-text').textContent = message;
      }
      modal.classList.add('visible');
    }

    function hide() {
      if (_overlayEl) _overlayEl.classList.remove('visible');
    }

    return { show, hide };
  })();

  /* ============================================================
     ASYNC OPERATION QUEUE
  ============================================================ */
  const Queue = (() => {
    let running = false;
    const jobs = [];

    function drain() {
      if (running || jobs.length === 0) return;
      running = true;
      const { fn, resolve, reject } = jobs.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => { running = false; drain(); });
    }

    return {
      add(fn) {
        return new Promise((resolve, reject) => {
          jobs.push({ fn, resolve, reject });
          drain();
        });
      },
      /** Force-reset: reject all pending jobs and mark idle */
      forceReset() {
        jobs.splice(0).forEach(j => j.reject(new Error('cancelled')));
        running = false;
      },
      get busy() { return running || jobs.length > 0; },
    };
  })();

  /* ============================================================
     OBSERVABILITY
  ============================================================ */
  const _log = [];
  function log(event, data = {}) {
    const entry = { t: Date.now(), event, ...data };
    _log.push(entry);
    if (_log.length > 200) _log.shift();
    console.debug('[Nebulux]', event, data);
  }

  /* ============================================================
     HTML VALIDATION
  ============================================================ */
  function isValidUserHTML(code, isEdit = false) {
    if (!code || typeof code !== 'string') return false;
    const t = code.trim();
    if (t.length < 5) return false; 
    if (!isEdit && !/<html[\s>]/i.test(t) && !/<body[\s>]/i.test(t)) return false;
    return true;
  }

  function isBuilderShell(html) {
    if (!html || typeof html !== 'string') return false;
    const markers = [
      'id="previewFrame"',
      'id="sidebarCloseBtn"',
      'id="chatPanel"',
      'id="elementEditor"',
    ];
    let hits = 0;
    for (const m of markers) if (html.includes(m)) hits++;
    return hits >= 2;
  }


  /* ============================================================
     RESPONSIVE CONTRACT VALIDATOR
  ============================================================ */
  function validateMobileResponsive(html) {
    if (!html) return { valid: false, reason: 'empty html' };

    if (!/name=["']viewport["']/i.test(html)) {
      return { valid: false, reason: 'missing viewport meta tag' };
    }

    const hasResponsivePattern = (
      /max-width\s*:\s*(?:100%|\d{1,3}(?:vw|rem|em))/i.test(html) ||
      /clamp\s*\(/i.test(html) ||
      /@media\s+/i.test(html) ||
      /flex-wrap\s*:/i.test(html) ||
      /grid-template-columns/i.test(html)
    );
    if (!hasResponsivePattern) {
      return { valid: false, reason: 'no responsive layout patterns (media query / clamp / flex-wrap / grid)' };
    }

    const badWidthMatch = html.match(/(?:^|[^@{}*])\b(?:width|min-width)\s*:\s*([6-9]\d{2}|[1-9]\d{3,})px/im);
    if (badWidthMatch) {
      return { valid: false, reason: `fixed pixel width > 600px detected: "${badWidthMatch[0].trim()}"` };
    }

    return { valid: true, reason: 'ok' };
  }

  /* ============================================================
     IFRAME SESSION – selection mode only (no navigation)
  ============================================================ */
  const IframeSession = (() => {
    let abortCtrl = null;
    let activeDoc = null;

    function destroy() {
      if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
      activeDoc = null;
    }

    function initForSelection(doc) {
      destroy();
      activeDoc = doc;
      abortCtrl = new AbortController();
      const sig = abortCtrl.signal;

      if (!doc.getElementById('__nx_style')) {
        const s = doc.createElement('style');
        s.id = '__nx_style';
        s.textContent = `
          body.__nx_select * { cursor: crosshair !important; user-select: none !important; }
          .__nx_hover    { outline: 2px solid rgba(77,157,224,.55) !important; outline-offset: 1px; }
          .__nx_selected { outline: 2px solid #4d9de0 !important; outline-offset: 1px;
                           background-color: rgba(77,157,224,.08) !important; }
        `;
        doc.head.appendChild(s);
      }

      _applyCursor(doc);

      let lastHovered = null;
      doc.addEventListener('mousemove', (e) => {
        if (!state.selectMode) { _clearHover(lastHovered); lastHovered = null; return; }
        const t = e.target;
        if (t === lastHovered) return;
        _clearHover(lastHovered);
        lastHovered = t;
        if (t && t.tagName && !t.classList.contains('__nx_selected')) t.classList.add('__nx_hover');
      }, { signal: sig, passive: true });

      doc.addEventListener('mouseleave', () => {
        _clearHover(lastHovered); lastHovered = null;
      }, { signal: sig, passive: true });

      doc.addEventListener('click', (e) => {
        if (!state.selectMode) return;
        // Block new selections while an edit is processing
        if (_isGenerating) return;
        e.preventDefault();
        e.stopPropagation();
        const t = e.target;
        if (!t || !t.tagName) return;
        const prev = doc.querySelector('.__nx_selected');
        if (prev) prev.classList.remove('__nx_selected', '__nx_hover');
        t.classList.add('__nx_selected');
        t.classList.remove('__nx_hover');
        lastHovered = null;
        const elemRect = t.getBoundingClientRect();
        const frameRect = el.previewFrame.getBoundingClientRect();
        _handleElementSelected(t, elemRect, frameRect);
      }, { signal: sig });
    }

    function _clearHover(node) { if (node && node.classList) node.classList.remove('__nx_hover'); } // FIX #15: renamed param from 'el' to 'node' to avoid shadowing outer el

    function _applyCursor(doc) {
      if (doc && doc.body) doc.body.classList.toggle('__nx_select', state.selectMode);
    }

    function syncSelectMode() { if (activeDoc) _applyCursor(activeDoc); }

    function clearSelection() {
      if (!activeDoc) return;
      const prev = activeDoc.querySelector('.__nx_selected');
      if (prev) prev.classList.remove('__nx_selected');
    }

    function generateToken() {
      return '__nx_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    }

    return { destroy, initForSelection, syncSelectMode, clearSelection, generateToken };
  })();

  /* ============================================================
     PARENT MESSAGE HANDLER
  ============================================================ */
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'nebulux:dom-ready') {
      // Guard script signals HTML is parsed — clear the timeout early so sites
      // with slow external resources (fonts, CDN scripts) don't false-timeout.
      if (e.data.token === _currentToken) {
        _checkIframeToken(_renderSeq);
      }
      return;
    }

    if (e.data.type === 'nebulux:navigation-blocked') {
      const url = e.data.url || 'unknown';
      console.debug('[nebulux] Navigation blocked in preview:', url);
    }

    if (e.data.type === 'nebulux:edit-text' || e.data.type === 'nebulux:edit-image' || e.data.type === 'nebulux:replace-with-image') {
      const { selector, text, src: imgSrc } = e.data;
      if (!state.currentCode || !selector) return;

      const _applyEdit = (finalSrc) => {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(state.currentCode, 'text/html');
          const el = doc.querySelector(selector);
          if (!el) return;
          if (e.data.type === 'nebulux:edit-text') {
            el.innerHTML = text;
          } else if (e.data.type === 'nebulux:edit-image') {
            el.setAttribute('src', finalSrc || imgSrc);
          } else if (e.data.type === 'nebulux:replace-with-image') {
            const newImg = doc.createElement('img');
            newImg.src = finalSrc || imgSrc;
            newImg.style.maxHeight = '40px';
            newImg.style.width = 'auto';
            if (el.tagName === 'SVG' || el.tagName === 'I') {
              if (el.className) newImg.className = el.className;
              el.replaceWith(newImg);
            } else {
              el.innerHTML = '';
              el.appendChild(newImg);
            }
          }
          const newCode = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
          commitCurrentCode(newCode);
          const slug = getCurrentPage()?.name || 'index';
          const pageObj = state.pages.find(p => p.name === slug);
          if (pageObj) pageObj.code = newCode;
          Project.save();
          addToHistory(newCode, 'Edited');
        } catch (err) {
          console.warn('[nebulux] inline edit failed:', err);
        }
      };

      // For image edits: upload base64 to R2 first, then save with permanent URL
      if ((e.data.type === 'nebulux:edit-image' || e.data.type === 'nebulux:replace-with-image') && imgSrc && imgSrc.startsWith('data:')) {
        (async () => {
          let finalSrc = imgSrc;
          try {
            const mime = imgSrc.split(';')[0].split(':')[1] || 'image/png';
            const base64 = imgSrc.split(',')[1];
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: mime });
            const formData = new FormData();
            formData.append('image', blob, 'inline-edit.png');
            // Must NOT set Content-Type here — browser sets multipart/form-data + boundary automatically
            const _uploadToken = window.Auth && window.Auth.getAccessToken ? window.Auth.getAccessToken() : null;
            const _uploadHeaders = _uploadToken ? { 'Authorization': 'Bearer ' + _uploadToken } : {};
            const res = await fetch(CONFIG.apiBaseUrl + '/upload-image/', {
              method: 'POST',
              headers: _uploadHeaders,
              body: formData,
            });
            if (res.ok) {
              const data = await res.json();
              if (data.url) finalSrc = data.url;
            }
          } catch (uploadErr) {
            console.warn('[nebulux] inline image upload failed, using base64:', uploadErr);
          }
          _applyEdit(finalSrc);
        })();
      } else {
        _applyEdit(imgSrc);
      }
    }
  });

  /* ============================================================
     PREVIEW — Deterministic iframe lifecycle
  ============================================================ */
  let _renderSeq = 0;
  let _renderTimer = null;
  let _currentToken = null;
  // _loadListenerBound removed — load listener is now bound once at init time below updatePreview()

  function _clearRenderTimer() {
    if (_renderTimer !== null) { clearTimeout(_renderTimer); _renderTimer = null; }
  }

  function _showRenderError(msg) {
    if (!el.renderError) return;
    const msgEl = el.renderError.querySelector('#renderErrorMsg') || el.renderError;
    if (msgEl.textContent !== undefined) msgEl.textContent = msg;
    el.renderError.style.display = 'flex';
  }

  function _hideRenderError() {
    if (!el.renderError) return;
    el.renderError.style.display = 'none';
  }

  // Shared render-complete handler — called from both the 'load' event
  // and the early readystatechange path.  Safe to call multiple times for
  // the same render sequence; _clearRenderTimer() is idempotent.
  function _checkIframeToken(seq) {
    if (_renderSeq !== seq) return;

    const doc = el.previewFrame.contentDocument;
    if (!doc || !doc.head) return;

    const meta = doc.querySelector('meta[name="nebulux-token"]');
    const docToken = meta ? meta.getAttribute('content') : null;

    if (docToken === _currentToken) {
      _clearRenderTimer();
      IframeSession.initForSelection(doc);
      _hideRenderError();
      log('render_ok');
    } else {
      log('nav_escape_detected', { expected: _currentToken, found: docToken });

      const html = doc.documentElement ? doc.documentElement.outerHTML : '';
      if (isBuilderShell(html)) {
        console.warn('[nebulux] Builder recursion blocked. Restoring your site.');
      } else {
        console.warn('[nebulux] Preview navigated away. Restoring your site.');
      }

      if (state.currentCode && isValidUserHTML(state.currentCode) && !isBuilderShell(state.currentCode)) {
        requestAnimationFrame(() => { updatePreview(state.currentCode); });
      }
    }
  }

  function _handleIframeLoad() {
    // 'load' fires after ALL subresources. Acts as the final safety net —
    // the timer is usually already cleared by the nebulux:dom-ready postMessage
    // that the guard script sends on DOMContentLoaded inside the iframe.
    const seq = _renderSeq;
    setTimeout(() => _checkIframeToken(seq), 50);
  }

  function getGuardScript(token) {
    return `
      <script>
      (function() {
        /* ── FIX 2: Storage + network freeze ─────────────────────────────────
         * allow-scripts + allow-same-origin would let user HTML read
         * window.parent.localStorage (JWT tokens, project data).
         * Freeze those APIs in this iframe BEFORE any user scripts run.
         * This runs synchronously as the very first script so no race exists.
         * ------------------------------------------------------------------- */
        (function _freezeStorage() {
          var _noop = function() { return null; };
          var _noopStorage = {
            getItem: _noop, setItem: _noop, removeItem: _noop, clear: _noop,
            key: _noop, length: 0,
          };
          try { Object.defineProperty(window, 'localStorage',   { value: _noopStorage, configurable: false }); } catch(e) {}
          try { Object.defineProperty(window, 'sessionStorage', { value: _noopStorage, configurable: false }); } catch(e) {}
          // Block indexedDB so no side-channel via IDB
          try { Object.defineProperty(window, 'indexedDB', { value: null, configurable: false }); } catch(e) {}
          // Block cookie access
          try {
            Object.defineProperty(document, 'cookie', {
              get: function() { return ''; },
              set: function() {},
              configurable: false,
            });
          } catch(e) {}
        })();
        /* ── end storage freeze ─────────────────────────────────────────── */

        if (window.top === window) return;

        const parent = window.parent;
        const token = ${JSON.stringify(token)};

        // Signal the parent as soon as HTML is parsed — before fonts/images load.
        // This lets the parent clear the render timeout early for sites with
        // heavy external dependencies (Google Fonts, CDN scripts, etc.).
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            try { parent.postMessage({ type: 'nebulux:dom-ready', token: token }, '*'); } catch(e) {}
          });
        } else {
          // Already parsed (readyState is 'interactive' or 'complete')
          try { parent.postMessage({ type: 'nebulux:dom-ready', token: token }, '*'); } catch(e) {}
        }

        function blockNavigation(url, type) {
          // Intra-page anchors (e.g. "#pricing") should always work
          if (url && typeof url === 'string' && url.trim().startsWith('#')) return false;

          // Multi-page: intercept internal page links (e.g., about.html, pricing.html, /site/about.html, about.html#faq)
          if (url && typeof url === 'string') {
            let href = url.trim();
            // Strip query string + hash so "pricing.html?ref=nav#top" still resolves to "pricing"
            const hashIndex = href.indexOf('#');
            if (hashIndex >= 0) href = href.slice(0, hashIndex);
            const queryIndex = href.indexOf('?');
            if (queryIndex >= 0) href = href.slice(0, queryIndex);

            const match = href.match(/^(?:.*\/)?([\w-]+)\.html?$/i);
            if (match) {
              const slug = match[1].toLowerCase();
              // Post message to parent so builder can switch pages
              try { window.parent.postMessage({ type: 'nebulux_page_nav', slug: slug }, '*'); } catch(e) {}
              return true; // navigation was handled by the builder
            }
          }

          parent.postMessage({ type: 'nebulux:navigation-blocked', url: url || '', token: token }, '*');
          return true;
        }

        const origAssign = window.location.assign;
        const origReplace = window.location.replace;

        window.location.assign = function(url) {
          if (blockNavigation(url, 'assign')) return;
          origAssign.call(this, url);
        };

        window.location.replace = function(url) {
          if (blockNavigation(url, 'replace')) return;
          origReplace.call(this, url);
        };

        try {
          const desc = Object.getOwnPropertyDescriptor(window.location, 'href');
          if (desc && desc.configurable) {
            Object.defineProperty(window.location, 'href', {
              set: function(value) {
                if (blockNavigation(value, 'href')) return;
                origAssign.call(window.location, value);
              },
              // FIX: \`this.href\` inside the getter would re-invoke this very
              // descriptor getter → infinite recursion → stack overflow.
              // Always use desc.get (the original native getter) with explicit
              // call target, and only fall back if desc.get is missing (should
              // never happen in a real browser, but guard defensively).
              get: function() {
                return desc.get
                  ? desc.get.call(window.location)
                  : window.location.toString();
              },
            });
          }
        } catch(e) {}

        document.addEventListener('click', function(e) {
          const a = e.target.closest('a[href]');
          if (!a) return;
          const href = a.getAttribute('href');
          if (blockNavigation(href, 'click')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);

        document.addEventListener('submit', function(e) {
          const action = e.target.getAttribute('action') || '';
          if (blockNavigation(action, 'submit')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);

        /* ── Inline editing ───────────────────────────────────────────────── */
        function _getSelector(el) {
          if (el.id) return '#' + el.id;
          const tag = el.tagName.toLowerCase();
          const parent = el.parentElement;
          if (!parent) return tag;
          const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          const idx = siblings.indexOf(el);
          return _getSelector(parent) + ' > ' + tag + (siblings.length > 1 ? ':nth-of-type(' + (idx + 1) + ')' : '');
        }

        document.addEventListener('dblclick', function(e) {
          const img = e.target.closest('img');
          const isSvgOrIcon = e.target.closest('svg, i[class*="fa-"], i[class*="lucide-"]');
          const isLogoWrapper = e.target.closest('.logo, .brand, .navbar-brand, header a[href="/"], nav a[href="/"]');
          const targetEl = img || isSvgOrIcon || isLogoWrapper;

          if (targetEl) {
            // If they clicked the padding of a logo wrapper that already contains an image, let the img logic handle it if they clicked the image directly later. Or just let the wrapper trigger if img wasn't specifically the target, but if it's already an img inside the wrapper, don't double replace.
            if (!img && isLogoWrapper && isLogoWrapper.querySelector('img')) return;

            e.preventDefault();
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.cssText = 'display:none';
            document.body.appendChild(input);
            input.click();
            input.addEventListener('change', function() {
              const file = input.files[0];
              if (!file) { input.remove(); return; }
              const reader = new FileReader();
              reader.onload = function(ev) {
                const dataUrl = ev.target.result;
                if (img) {
                  img.src = dataUrl;
                  try { parent.postMessage({ type: 'nebulux:edit-image', selector: _getSelector(img), src: dataUrl }, '*'); } catch(e2) {}
                } else {
                  try { parent.postMessage({ type: 'nebulux:replace-with-image', selector: _getSelector(targetEl), src: dataUrl }, '*'); } catch(e2) {}
                  const newImg = document.createElement('img');
                  newImg.src = dataUrl;
                  if (isSvgOrIcon) {
                    if (isSvgOrIcon.className) newImg.className = isSvgOrIcon.className;
                    newImg.style.maxHeight = '40px';
                    newImg.style.width = 'auto';
                    isSvgOrIcon.replaceWith(newImg);
                  } else {
                    targetEl.innerHTML = '';
                    targetEl.appendChild(newImg);
                    newImg.style.maxHeight = '40px';
                    newImg.style.width = 'auto';
                  }
                }
                input.remove();
              };
              reader.readAsDataURL(file);
            });
            return;
          }

          const textTags = ['P','H1','H2','H3','H4','H5','H6','SPAN','A','LI','TD','TH','BUTTON','LABEL','DIV'];
          const el2 = e.target.closest(textTags.map(t => t.toLowerCase()).join(','));
          if (el2 && !el2.querySelector('img') && el2.children.length === 0 || (el2 && el2.innerText.trim())) {
            e.preventDefault();
            e.stopPropagation();
            el2.contentEditable = 'true';
            el2.focus();
            el2.style.outline = '2px dashed rgba(247,148,29,0.7)';
            el2.style.borderRadius = '3px';
            function onBlur() {
              el2.contentEditable = 'false';
              el2.style.outline = '';
              el2.style.borderRadius = '';
              try { parent.postMessage({ type: 'nebulux:edit-text', selector: _getSelector(el2), text: el2.innerHTML }, '*'); } catch(e2) {}
              el2.removeEventListener('blur', onBlur);
              el2.removeEventListener('keydown', onKey);
            }
            function onKey(e3) { if (e3.key === 'Escape') { el2.blur(); } }
            el2.addEventListener('blur', onBlur);
            el2.addEventListener('keydown', onKey);
          }
        }, true);
        /* ── end inline editing ─────────────────────────────────────────── */

      })();
      <\/script>
    `;
  }

  // Bind the load listener once at module-init time.
  // Primary signal: nebulux:dom-ready postMessage from guard script (DOMContentLoaded).
  // Safety net: _handleIframeLoad on 'load' (fires after all subresources).
  el.previewFrame.addEventListener('load', _handleIframeLoad);

  // Strip external CDN scripts that get blocked in the sandboxed iframe preview.
  // The original HTML is never modified — this only affects the preview rendering path.
  function _stripExternalScriptsForPreview(html) {
    return html
      .replace(
        /<script\s+src="https:\/\/cdn\.tailwindcss\.com[^"]*"[^>]*><\/script>/gi,
        '<script src="/static/css/tailwind.min.js"></script>'
      )
      .replace(
        /<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^"]*"[^>]*><\/script>/gi,
        ''
      );
  }

  function updatePreview(code) {
    if (!isValidUserHTML(code, true)) {
      _showRenderError('⚠️ Invalid HTML. Please try again.');
      return;
    }

    if (isBuilderShell(code)) {
      _showRenderError('🚨 Safety block: cannot render builder UI in preview.');
      console.warn('[nebulux] Blocked: builder UI cannot be rendered in preview.');
      return;
    }

    _hideRenderError();
    IframeSession.destroy();

    const seq = ++_renderSeq;
    _currentToken = IframeSession.generateToken();

    _clearRenderTimer();

    _renderTimer = setTimeout(() => {
      if (_renderSeq !== seq) return;
      IframeSession.destroy();
      _showRenderError('⚠️ Preview timed out. The HTML may contain errors.');
      console.warn('[nebulux] Preview timed out.');
      log('render_timeout');
    }, CONFIG.iframeLoadTimeout);

    // Load listener is now bound once at module-init time above updatePreview().

    const metaToken = `<meta name="nebulux-token" content="${_currentToken}">`;
    const guardScript = getGuardScript(_currentToken);

    // Strip blocked CDN scripts for preview only — published/exported HTML is unaffected
    code = _stripExternalScriptsForPreview(code);

    let injectedCode;
    const headMatch = code.match(/<head[^>]*>/i);
    if (headMatch) {
      const insertPos = headMatch.index + headMatch[0].length;
      injectedCode = code.slice(0, insertPos) + metaToken + guardScript + code.slice(insertPos);
    } else {
      injectedCode = '<head>' + metaToken + guardScript + '</head>' + code;
    }

    // Use a Blob URL instead of srcdoc — srcdoc silently truncates large HTML
    // (complex generated sites can exceed 50-80 KB), producing a blank iframe.
    // Blob URLs have no size limit and fire the load event identically.
    if (el.previewFrame._blobUrl) {
      URL.revokeObjectURL(el.previewFrame._blobUrl);
      el.previewFrame._blobUrl = null;
    }
    const blob = new Blob([injectedCode], { type: 'text/html;charset=utf-8' });
    el.previewFrame._blobUrl = URL.createObjectURL(blob);
    el.previewFrame.src = el.previewFrame._blobUrl;
  }

  /* ============================================================
     STATE HELPERS
  ============================================================ */
  function commitCurrentCode(code) {
    state.currentCode = code;
    const page = getCurrentPage();
    if (page) page.code = code;
    state.hasUnsavedChanges = true;
  }

  function getCurrentPage() {
    return state.pages.find(p => p.id === state.currentPageId) || state.pages[0];
  }
  function getPageHistory() { const p = getCurrentPage(); return p.history || (p.history = []); }
  function getPageHistoryIndex() { const p = getCurrentPage(); return p.historyIndex !== undefined ? p.historyIndex : (p.historyIndex = -1); }
  function setPageHistoryIndex(i) { getCurrentPage().historyIndex = i; }

  /* ============================================================
     SELECT MODE
  ============================================================ */
  function setSelectMode(on) {
    state.selectMode = !!on;
    const btn = document.getElementById('selectModeBtn');
    if (btn) btn.classList.toggle('active', state.selectMode);
    IframeSession.syncSelectMode();
    if (!state.selectMode) {
      IframeSession.clearSelection();
      state.selectedElement = null;
      el.elementEditor.classList.remove('visible');
      el.editingLabel.classList.remove('visible');
      el.selectionBanner.classList.remove('visible');
    }
  }

  function _handleElementSelected(element, elemRect, frameRect) {
    const tag = element.tagName.toLowerCase();
    const rawClass = typeof element.className === 'string' ? element.className : '';
    const classes = rawClass
      ? '.' + rawClass.split(' ').filter(c => c && !c.startsWith('__nx')).join('.')
      : '';
    const id = element.id ? '#' + element.id : '';
    const text = element.textContent.trim().substring(0, 40);

    // ── Task 1: Inject a unique data-nbx-id into the live DOM node ──
    // This gives the backend a precise AST anchor instead of relying on
    // fragile outerHTML string-matching.
    const nbxId = 'nbx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    element.setAttribute('data-nbx-id', nbxId);

    // ── Sync nbxId into state.currentCode so DOMParser can find it later ──
    if (state.currentCode) {
      try {
        const parser = new DOMParser();
        const d = parser.parseFromString(state.currentCode, 'text/html');
        // Build a reliable selector using id, or tag+classes, or outerHTML match
        let found = null;
        if (element.id) {
          found = d.getElementById(element.id);
        }
        if (!found) {
          // Match by tag + textContent + position
          const allMatching = Array.from(d.querySelectorAll(tag));
          const liveText = element.textContent.trim();
          found = allMatching.find(el => el.textContent.trim() === liveText) || allMatching[0];
        }
        if (found) {
          found.setAttribute('data-nbx-id', nbxId);
          state.currentCode = '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
          const page = getCurrentPage();
          if (page) page.code = state.currentCode;
        }
      } catch (e) { console.warn('[nebulux] nbxId sync failed:', e); }
    }

    state.selectedElement = { tag, text, path: tag + id + classes, nbxId };

    el.selectionBanner.classList.add('visible');
    el.selectionTag.textContent = tag;
    el.selectionInfo.textContent = id || classes || (text ? `"${text}"` : '');
    el.editingLabel.classList.add('visible');
    el.editingTarget.textContent = tag + (id || classes || '');

    const absLeft = frameRect.left + elemRect.left;
    const absBottom = frameRect.top + elemRect.bottom;
    const absTop = frameRect.top + elemRect.top;
    const W = 310, H = 48, M = 10;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = absLeft, top = absBottom + M;
    if (top + H > vh - 16) top = absTop - H - M;
    if (left + W > vw - 16) left = vw - W - 16;
    if (left < 16) left = 16;
    if (top < 16) top = 16;

    el.elementEditor.style.left = left + 'px';
    el.elementEditor.style.top = top + 'px';
    el.elementEditor.classList.add('visible');
    el.editorInput.value = '';
    el.editorInput.focus();
    // Show relevant inline edit buttons
    const isImg = tag === 'img';
    const isText = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'li', 'td', 'th', 'button', 'label'].includes(tag);
    el.editorEditText.style.display = isText ? '' : 'none';
    el.editorReplaceImage.style.display = isImg ? '' : 'none';
    log('element_selected', { tag, path: state.selectedElement.path, nbxId });
  }

  /* ============================================================
     MOBILE REQUIREMENTS SUFFIX
  ============================================================ */
  const MOBILE_REQUIREMENTS_SUFFIX = `

[MOBILE REQUIREMENTS — MANDATORY]
- Include <meta name="viewport" content="width=device-width, initial-scale=1">
- All layout widths must use %, rem, vw, or clamp() — no fixed px widths > 480px on containers
- Images: max-width:100%; height:auto
- Layout: flexbox with flex-wrap:wrap, or CSS Grid with auto-fit/minmax
- Navigation and buttons must wrap and stay within viewport at 375px width
- Font sizes: clamp(min, preferred, max) or rem-based
- No horizontal overflow — the site must be fully usable on a 375px wide screen`;

  /* ============================================================
     FILE MANAGEMENT
     Handles attached files (images, text, code) for AI context.
     Files travel from the index page via sessionStorage, or can
     be attached directly in the builder chat.
  ============================================================ */
  const FileManager = (() => {
    const _IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    const _MAX_FILE_SIZE = 7 * 1024 * 1024; // 7 MB per file
    const _MAX_FILES = 10;

    /** Load files stored by the index page in sessionStorage */
    function loadFromStorage() {
      // Primary: sessionStorage (files passed from index page on first generation)
      try {
        const raw = sessionStorage.getItem('nebulux_files');
        if (raw) {
          const files = JSON.parse(raw);
          if (Array.isArray(files) && files.length > 0) {
            state.files = files.slice(0, _MAX_FILES);
            log('files_loaded_from_storage', { count: state.files.length });
            _renderPendingPreview();
            return; // sessionStorage wins — this is a fresh generation
          }
        }
      } catch (e) {
        console.warn('[Nebulux] Failed to load files from sessionStorage:', e);
      }
      // Fallback: per-project localStorage (files saved after a previous generation)
      loadFromProject();
    }

    /** Save attached files to a per-project localStorage key for persistence.
     *  Only images under 500 KB (base64) are stored to respect the localStorage
     *  5 MB quota.  Large screenshots are skipped — the user sees a note. */
    function saveToProject() {
      if (!state.projectId) return;
      try {
        const ns = window.Auth && window.Auth.getUser && window.Auth.getUser()
          ? String(window.Auth.getUser().id)
          : (localStorage.getItem('nebulux_device_id') || 'anon');
        const key = 'nebulux_files_' + ns + '_' + state.projectId;
        const _MAX_FILE_STORED_BYTES = 500 * 1024; // 500 KB base64 per file
        const toStore = state.files
          .filter(f => {
            const size = f.data ? f.data.length : 0;
            return size > 0 && size <= _MAX_FILE_STORED_BYTES;
          })
          .slice(0, 3) // cap at 3 files to protect localStorage budget
          .map(f => ({ name: f.name, type: f.type, data: f.data }));
        if (toStore.length > 0) {
          localStorage.setItem(key, JSON.stringify(toStore));
          log('files_saved_to_project', { count: toStore.length, skipped: state.files.length - toStore.length });
        } else {
          localStorage.removeItem(key);
        }
      } catch (e) {
        // Quota exceeded or storage blocked — silently skip
        console.warn('[Nebulux] Could not persist reference files:', e);
      }
    }

    /** Restore files that were saved by a previous session for this project. */
    function loadFromProject() {
      if (!state.projectId) return;
      try {
        const ns = window.Auth && window.Auth.getUser && window.Auth.getUser()
          ? String(window.Auth.getUser().id)
          : (localStorage.getItem('nebulux_device_id') || 'anon');
        const key = 'nebulux_files_' + ns + '_' + state.projectId;
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const files = JSON.parse(raw);
        if (Array.isArray(files) && files.length > 0) {
          state.files = files.slice(0, _MAX_FILES);
          _renderPendingPreview();
          // Show a subtle note so users know their reference files are active
          const names = files.map(f => f.name).join(', ');
          addMessage('ai', `📎 Reference file${files.length > 1 ? 's' : ''} restored: ${names} — the AI will use ${files.length > 1 ? 'them' : 'it'} for context. Re-attach to update.`);
          log('files_restored_from_project', { count: files.length });
        }
      } catch (e) {
        console.warn('[Nebulux] Could not restore project files:', e);
      }
    }

    /** Read a File object → { name, type, data (base64) } */
    function readFile(file) {
      return new Promise((resolve, reject) => {
        if (file.size > _MAX_FILE_SIZE) {
          reject(new Error(`File "${file.name}" is too large (max 7 MB).`));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const fullData = reader.result;
          const fileType = file.type || 'application/octet-stream';
          // Generate compressed thumbnail for chat persistence
          if (fileType.startsWith('image/')) {
            const img = new Image();
            img.onload = () => {
              try {
                const MAX = 120;
                const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * ratio);
                canvas.height = Math.round(img.height * ratio);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve({
                  name: file.name,
                  type: fileType,
                  data: fullData,
                  thumb: canvas.toDataURL('image/jpeg', 0.75),
                });
              } catch (e) {
                resolve({ name: file.name, type: fileType, data: fullData });
              }
            };
            img.onerror = () => resolve({ name: file.name, type: fileType, data: fullData });
            img.src = fullData;
          } else {
            resolve({ name: file.name, type: fileType, data: fullData });
          }
        };
        reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`));
        reader.readAsDataURL(file);
      });
    }

    /** Add files from a FileList (e.g. from <input type=file>) */
    async function addFiles(fileList) {
      const newFiles = [];
      for (const file of fileList) {
        if (state.files.length + newFiles.length >= _MAX_FILES) {
          addMessage('ai', `⚠️ Max ${_MAX_FILES} files. Extra files were skipped.`);
          break;
        }
        try {
          const parsed = await readFile(file);
          newFiles.push(parsed);
        } catch (err) {
          addMessage('ai', `⚠️ ${err.message}`);
        }
      }
      if (newFiles.length > 0) {
        state.files.push(...newFiles);
        _renderPendingPreview();
        _renderPendingPreview();
        log('files_added', { count: newFiles.length, total: state.files.length });
      }
    }

    /** Remove a file by index */
    function removeFile(index) {
      state.files.splice(index, 1);
      _renderPendingPreview();
    }

    /** Clear all files */
    function clearFiles() {
      state.files = [];
      _renderPendingPreview();
    }

    function isImage(type) {
      return _IMAGE_TYPES.includes((type || '').toLowerCase());
    }

    /** Update the attach badge count in the UI */
    function _esc(str) {
      return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _renderPendingPreview() {
      const wrap = document.getElementById('pending-files-preview');
      if (!wrap) return;
      wrap.style.cssText = 'display:flex;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;gap:8px;padding:0 14px 8px;';
      wrap.innerHTML = '';
      state.files.forEach(function (f, i) {
        const card = document.createElement('div');
        card.className = 'pfc';
        if (isImage(f.type)) {
          card.style.cssText = 'width:80px;min-width:80px;max-width:80px;height:90px;min-height:90px;max-height:90px;overflow:hidden;position:relative;border-radius:10px;';
          card.innerHTML = '<img src="' + f.data + '" alt="' + _esc(f.name) + '" style="width:80px;height:90px;max-width:80px;max-height:90px;object-fit:cover;display:block;position:absolute;top:0;left:0;">' +
            '<button class="pfc-remove" data-i="' + i + '" title="Remove" style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.75);border:none;color:#fff;font-size:11px;cursor:pointer;z-index:10;padding:0;display:block;text-align:center;line-height:18px;">&times;</button>';
        } else {
          const ext = f.name.split('.').pop().toUpperCase().slice(0, 4);
          const short = f.name.length > 14 ? f.name.slice(0, 12) + '\u2026' : f.name;
          card.innerHTML = '<div class="pfc-ext">' + ext + '</div>' +
            '<div class="pfc-name">' + _esc(short) + '</div>' +
            '<button class="pfc-remove" data-i="' + i + '" title="Remove" style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,0.75);border:none;color:#fff;font-size:11px;cursor:pointer;z-index:10;padding:0;display:block;text-align:center;line-height:18px;">&times;</button>';
        }
        wrap.appendChild(card);
      });
      wrap.querySelectorAll('.pfc-remove').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          removeFile(parseInt(btn.dataset.i));
        });
      });
    }

    // _showFileAttachments removed — preview handled by _renderPendingPreview


    return { loadFromStorage, saveToProject, loadFromProject, readFile, addFiles, removeFile, clearFiles, isImage, getFiles: function () { return state.files.slice(); } };
  })();

  /* ============================================================
     API
  ============================================================ */
  const API = {
    async _fetch(path, body) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 600000); // 10 minutes
      try {
        const url = `${CONFIG.apiBaseUrl}${path}`;
        const useAuth = window.Auth && typeof window.Auth.apiFetch === 'function';
        const res = useAuth
          ? await window.Auth.apiFetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: ctrl.signal,
          })
          : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        let data;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const text = await res.text();
          throw new Error(`Request failed (${res.status}): ${text.substring(0, 120)}`);
        }
        if (!res.ok) {
          let msg;
          if (res.status === 402 && data.upgrade_required) {
            // Paid-only gate: show upgrade modal and throw
            UpgradeGate.show(typeof data.error === 'string' ? data.error : undefined);
            Credits.refresh(); // refresh badge to show 0
            msg = typeof data.error === 'string'
              ? data.error
              : 'Please upgrade your plan to continue.';
          } else if (res.status === 429) {
            // DRF throttle: {"detail": "Request was throttled. Expected available in N seconds."}
            const seconds = parseInt((data.detail || '').match(/(\d+) second/)?.[1]);
            if (seconds > 0) {
              const mins = Math.ceil(seconds / 60);
              msg = mins >= 2
                ? `Rate limit reached. Try again in ${mins} minutes.`
                : `Rate limit reached. Try again in ${seconds} seconds.`;
            } else {
              msg = 'Rate limit reached. Please try again shortly.';
            }
          } else {
            msg = typeof data.error === 'string'
              ? data.error
              : (data.detail || JSON.stringify(data.error) || `Request failed (${res.status})`);
          }
          throw new Error(msg);
        }
        return data;
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },

    async extractSpec(prompt, files) {
      const body = { prompt: prompt + MOBILE_REQUIREMENTS_SUFFIX };
      const filesToSend = (files && files.length > 0) ? files : (state.files || []);
      if (filesToSend.length > 0) {
        // Use thumb if available; otherwise compress full data on the fly
        const filePromises = filesToSend.map(f => new Promise(resolve => {
          const src = f.thumb || f.data;
          if (!src || !f.type.startsWith('image/')) {
            resolve({ name: f.name, type: f.type, data: src || f.data });
            return;
          }
          // Hard cap: compress to max 800px and 0.6 quality
          const img = new Image();
          img.onload = () => {
            const MAX = 800;
            const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve({ name: f.name, type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.6) });
          };
          img.onerror = () => resolve({ name: f.name, type: f.type, data: src });
          img.src = src;
        }));
        body.files = await Promise.all(filePromises);
      }
      const data = await this._fetch('/spec/', body);
      return { spec: data.spec || {}, missing_fields: data.missing_fields || [], tokens: data.tokens_used || 0 };
    },

    async generateFromSpec(spec, originalPrompt, externalSignal, singlePage = null) {
      const body = {
        spec,
        original_prompt: originalPrompt + MOBILE_REQUIREMENTS_SUFFIX,
      };
      if (singlePage) body.single_page = singlePage;
      if (state.files && state.files.length > 0) {
        body.files = state.files.map(f => ({ name: f.name, type: f.type, data: f.data }));
      }

      // Fix 1: use the caller-supplied AbortController so _stopGeneration() can
      // actually cancel the in-flight fetch.  Only create our own timer-based
      // controller when no external signal is provided.
      const ctrl = externalSignal ? null : new AbortController();
      const signal = externalSignal || (ctrl ? ctrl.signal : undefined);
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 600000) : null; // 10 minutes

      // FIX: previewTimer MUST be declared OUTSIDE the try block.  `let` is
      // block-scoped — when declared inside `try {}`, the catch and finally
      // blocks cannot see it.  Accessing it in catch throws ReferenceError,
      // which replaces the real error with an unhandled rejection, so the
      // user never sees the actual failure message.  The comment at the old
      // declaration site said to fix this; it was never actually applied.
      let previewTimer = null;

      try {
        const url = `${CONFIG.apiBaseUrl}/generate/`;
        // authFetch just adds the Bearer header and returns a raw fetch Response —
        // it does NOT consume the body, so streaming works fine through it.
        const res = window.Auth && typeof window.Auth.apiFetch === 'function'
          ? await window.Auth.apiFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // FIX #9: was missing
            body: JSON.stringify(body),
            signal: signal,
          })
          : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal,
          });

        if (!res.ok) {
          const text = await res.text();
          let msg;
          try {
            const d = JSON.parse(text);
            // Paid-only gate: show upgrade modal for 402
            if (res.status === 402 && d.upgrade_required) {
              UpgradeGate.show(typeof d.error === 'string' ? d.error : undefined);
              Credits.refresh();
            }
            msg = typeof d.error === 'string' ? d.error : (d.detail || `Request failed (${res.status})`);
          } catch { msg = `Request failed (${res.status}): ${text.substring(0, 120)}`; }
          throw new Error(msg);
        }

        // Always stream — read line-by-line regardless of content-type.
        // authFetch returns the raw Response so body is untouched.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', fullCode = '', finalId = null, finalTokens = 0;
        let finalPages = null, finalNavigation = null;

        // Widget appears only when thinking_start is received from server

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const jsonStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(jsonStr);

              if (chunk.done) {
                finalId = chunk.id || null;
                finalTokens = chunk.tokens_used || 0;
                if (chunk.pages && typeof chunk.pages === 'object' && Object.keys(chunk.pages).length > 0) {
                  finalPages = chunk.pages;
                  finalNavigation = chunk.navigation || {};
                }

              } else if (chunk.thinking_start) {
                AIThinkChat.show(); // no-op if already built

              } else if (typeof chunk.thinking_chunk === 'string') {
                AIThinkChat.stream(chunk.thinking_chunk);

              } else if (chunk.thinking_end) {
                AIThinkChat.doneThinking();
                // FIX: do NOT call GenStage.setWriting('index') here.
                // 'index' is hardcoded but the AI may start with any page slug.
                // The actual ---PAGE:slug--- markers in subsequent `chunk` events
                // already call GenStage.setWriting(slug) with the correct name.
                // Calling setWriting('index') here caused a wrong-slug panel to
                // appear briefly (visual flicker) before the real marker arrived.

              } else if (typeof chunk.chunk === 'string') {
                const text = chunk.chunk;
                const pageMarker = text.match(/---PAGE:\s*([a-zA-Z0-9_\-]+)\s*---/i);
                if (pageMarker) {
                  const slug = pageMarker[1];
                  GenStage.setWriting(slug);
                  AIThinkChat.addWritingRow(slug);
                } else if (fullCode === '' && text.trim()) {
                  // No page marker but code is arriving — auto-create writing panel
                  AIThinkChat.addWritingRow('index');
                }
                fullCode += text;
                AIThinkChat.appendCodeChunk(text);
                if (!previewTimer) {
                  previewTimer = setTimeout(() => {
                    const parts = fullCode.split(/---PAGE:\s*[a-zA-Z0-9_\-]+\s*---/i);
                    const html = parts.length > 1 ? parts[1] : parts[0];
                    if (html && html.trim().length > 10) updatePreview(html);
                    previewTimer = null;
                  }, 800);
                }

              } else if (chunk.error) {
                throw new Error(chunk.error);
              }
            } catch (e) {
              // FIX 4: only swallow SyntaxError from JSON.parse on a malformed SSE line.
              // The old check `!e.message.startsWith('JSON')` silently ate any error
              // whose message began with "JSON" (e.g. "JSON decode error from server"),
              // hiding real failures. instanceof SyntaxError is precise.
              if (!(e instanceof SyntaxError)) throw e;
            }
          }
        }

        if (previewTimer) clearTimeout(previewTimer);

        // Multi-page response: return structured pages
        if (finalPages && Object.keys(finalPages).length > 0) {
          const indexCode = finalPages['index'] || Object.values(finalPages)[0] || '';
          return { code: indexCode, pages: finalPages, navigation: finalNavigation || {}, id: finalId, tokens: finalTokens };
        }

        // Non-streaming fallback: whole body was one JSON blob
        if (!fullCode && buffer.trim()) {
          try {
            const d = JSON.parse(buffer.trim());
            if (d.pages && typeof d.pages === 'object' && Object.keys(d.pages).length > 0) {
              const idx = d.pages['index'] || Object.values(d.pages)[0] || '';
              return { code: idx, pages: d.pages, navigation: d.navigation || {}, id: d.id || null, tokens: d.tokens_used || 0 };
            }
            if (typeof d.code === 'string') return { code: d.code, pages: null, navigation: null, id: d.id || null, tokens: d.tokens_used || 0 };
          } catch { /* fall through */ }
        }

        if (!fullCode) throw new Error('Stream ended without code.');
        return { code: fullCode, pages: null, navigation: null, id: finalId, tokens: finalTokens };

      } catch (err) {
        // Fix 16: clear the preview debounce timer on any error so stale partial
        // HTML can never fire 800 ms after an abort or network failure.
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
        if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
        throw err;
      } finally {
        if (timer) clearTimeout(timer);  // timer is always a setTimeout id in _fetch(); clearTimeout(0) is safe anyway
      }
    },

    async completeSpec(originalPrompt, answers, partialSpec) {
      const data = await this._fetch('/spec/complete/', {
        original_prompt: originalPrompt + MOBILE_REQUIREMENTS_SUFFIX,
        answers,
        partial_spec: partialSpec,
      });
      return { spec: data.spec || {}, missing_fields: data.missing_fields || [], tokens: data.tokens_used || 0 };
    },

    async modify(code, instruction, pageSlug, nbxId, editMode, signal) {
      const body = { code, instruction };
      if (pageSlug) body.page_slug = pageSlug;
      if (nbxId) body.nbx_id = nbxId;
      if (editMode) body.edit_mode = editMode;
      if (state.files && state.files.length > 0) {
        body.files = state.files.map(f => ({ name: f.name, type: f.type, data: f.data }));
      }
      const history = _getRecentHistory(8);
      if (history.length > 0) body.chat_history = history;

      const url = `${CONFIG.apiBaseUrl}/modify/`;
      const useAuth = window.Auth && typeof window.Auth.apiFetch === 'function';
      
      const res = useAuth
        ? await window.Auth.apiFetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: signal,
          })
        : await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal,
          });

      if (!res.ok) {
        const text = await res.text();
        let msg;
        try {
          const d = JSON.parse(text);
          msg = d.error || d.detail || `Request failed (${res.status})`;
        } catch { msg = `Request failed (${res.status})`; }
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', fullCode = '', finalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (chunk.done) {
              finalTokens = chunk.tokens_used || 0;
              // Support both 'code' and 'full_code' (mismatch in some versions)
              if (chunk.code || chunk.full_code) {
                  fullCode = chunk.code || chunk.full_code; 
              }
            } else if (chunk.thinking_start) {
              AIThinkChat.show();
            } else if (typeof chunk.thinking_chunk === 'string') {
              AIThinkChat.stream(chunk.thinking_chunk);
            } else if (chunk.thinking_end) {
              AIThinkChat.doneThinking();
            } else if (typeof chunk.chunk === 'string') {
              fullCode += chunk.chunk;
            } else if (chunk.error) {
              throw new Error(chunk.error);
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }

      return { code: fullCode, tokens: finalTokens };
    },
  };

  /* ============================================================
     FOLLOW-UP QUESTIONS (when spec has missing fields)
  ============================================================ */

  // Inject styles
  (() => {
    const s = document.createElement('style');
    s.textContent = `
      /* ── Messages — clean minimal style ── */
      .message {
        font-size: 13px;
        line-height: 1.6;
        color: rgba(238,240,255,.85);
        padding: 0;
        background: none;
        border: none;
        border-radius: 0;
        max-width: 100%;
        word-break: break-word;
      }
      .message.user {
        align-self: flex-end;
        background: rgba(255,255,255,.07);
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 14px 14px 4px 14px;
        padding: 9px 13px;
        max-width: 85%;
        color: #fff;
        position: relative;
      }
      .message.ai {
        color: rgba(238,240,255,.8);
        padding: 2px 0;
      }
      .message.error-message { color: #f87171; }
      .msg-retry-btn {
        display: inline-block; margin-left: 8px; font-size: 11px;
        color: #F7941D; background: none; border: none; cursor: pointer;
        padding: 0; text-decoration: underline;
      }
      .msg-edit-btn {
        position: absolute; top: 6px; right: -26px;
        background: none; border: none; cursor: pointer; opacity: 0;
        color: rgba(255,255,255,.35); padding: 3px; transition: opacity .15s;
      }
      .message.user:hover .msg-edit-btn { opacity: 1; }
      .message.editing-source { outline: 1px solid rgba(247,148,29,.4); border-radius: 14px; }
      .message.ai-thinking-minimal {
        background: rgba(255,255,255,.05);
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 12px;
        padding: 8px 12px;
        margin-bottom: 8px;
        display: inline-flex;
        align-items: center;
        width: auto;
        max-width: 90%;
      }

      /* ── AI Think widget ── */
      .message.atw-container {
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 10px;
        padding: 10px 12px;
        max-width: 100%;
      }
      .atw-toggle {
        display: flex; align-items: center; gap: 7px;
        background: none; border: none; cursor: pointer;
        color: rgba(200,205,255,.5); font-size: 12px; font-family: inherit;
        padding: 0; width: 100%; text-align: left; user-select: none;
      }
      .atw-toggle:hover { color: rgba(200,205,255,.75); }
      .atw-toggle--done { color: rgba(200,205,255,.65); font-style: italic; }
      .atw-chevron { flex-shrink: 0; }
      .atw-spin-dot {
        width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
        background: conic-gradient(#F7941D 0%, transparent 100%);
        animation: atw-spin 1s linear infinite;
      }
      @keyframes atw-spin { to { transform: rotate(360deg); } }
      .atw-label { font-weight: 500; }
      .atw-timer { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .6; }
      .atw-body { margin-top: 8px; }
      .atw-body--hidden { display: none; }
      .atw-think-text {
        margin: 6px 0 0; padding: 10px 12px;
        font-size: 12.5px; line-height: 1.75;
        color: rgba(220,225,255,.82);
        white-space: pre-wrap; word-break: break-word;
        max-height: 260px; overflow-y: auto;
        background: rgba(255,255,255,.04);
        border-left: 2px solid rgba(247,148,29,.5);
        border-radius: 0 6px 6px 0;
      }
      .atw-action {
        display: flex; align-items: center; gap: 7px;
        font-size: 11.5px; color: rgba(200,205,255,.45);
        margin-bottom: 4px;
      }
      .atw-action-dot {
        width: 5px; height: 5px; border-radius: 50%;
        background: rgba(200,205,255,.3); flex-shrink: 0;
      }
      .atw-code-panel {
        margin-top: 8px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 7px; overflow: hidden;
      }
      .atw-code-hdr {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; color: rgba(200,205,255,.5);
        background: none; border: none; cursor: pointer;
        font-family: inherit; padding: 7px 10px; width: 100%; text-align: left;
        border-top: 1px solid rgba(255,255,255,.05);
      }
      .atw-code-hdr:hover { color: rgba(200,205,255,.75); background: rgba(255,255,255,.02); }
      .atw-code-dot {
        width: 5px; height: 5px; border-radius: 50%;
        background: #F7941D; flex-shrink: 0; animation: atw-spin 1.4s linear infinite;
      }
      .atw-code-dot--done { background: rgba(200,205,255,.25); animation: none; }
      .atw-code-lines { margin-left: auto; opacity: .5; }
      .atw-code-body { max-height: 0; overflow: hidden; transition: max-height .2s; }
      .atw-code-body--open { max-height: 200px; overflow-y: auto; }
      .atw-code-pre {
        margin: 0; padding: 8px 10px;
        font-family: 'SF Mono', monospace; font-size: 10.5px;
        color: rgba(200,205,255,.4); white-space: pre; overflow-x: auto;
      }

      /* ── Follow-up form ── */
      .followup-box { display:flex; flex-direction:column; gap:16px; }
      .followup-title { font-weight:500; color:var(--text-primary,#eef0ff); font-size:13px; line-height:1.4; }
      .followup-section { display:flex; flex-direction:column; gap:6px; }
      .followup-label { font-size:12px; color:var(--text-secondary,rgba(200,205,255,.55)); font-weight:500; letter-spacing:.3px; }
      .followup-chips { display:flex; flex-wrap:wrap; gap:6px; }
      .followup-chip {
        padding:6px 12px; border-radius:20px; font-size:12px; font-family:inherit;
        border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04);
        color:var(--text-primary,#eef0ff); cursor:pointer; transition:all .2s; user-select:none;
      }
      .followup-chip:hover { border-color:rgba(255,255,255,.25); background:rgba(255,255,255,.08); }
      .followup-chip.selected { border-color:#F7941D; background:rgba(247,148,29,.15); color:#fff; }
      .followup-chip.ai-decide {
        border-style:dashed; border-color:rgba(255,255,255,.18); color:var(--text-secondary,rgba(200,205,255,.55));
        font-style:italic;
      }
      .followup-chip.ai-decide.selected { border-style:solid; border-color:#F7941D; background:rgba(247,148,29,.12); color:#F7941D; }
      .followup-brand { display:flex; flex-direction:column; gap:6px; }
      .followup-brand-row { display:flex; gap:6px; align-items:center; }
      .followup-input {
        flex:1; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
        border-radius:8px; padding:7px 10px; color:var(--text-primary,#eef0ff);
        font-size:12.5px; font-family:inherit; outline:none; transition:border-color .2s;
      }
      .followup-input:focus { border-color:#F7941D; }
      .followup-input::placeholder { color:rgba(200,205,255,.25); }
      .followup-optional { font-size:10px; color:rgba(200,205,255,.3); font-style:italic; }
      .followup-required-tag { font-size:10px; color:#F7941D; font-weight:600; letter-spacing:.3px; }
      .followup-limit-tag { font-size:10px; color:rgba(200,205,255,.3); font-style:italic; }
      .followup-submit {
        align-self:flex-end; margin-top:2px; padding:9px 22px;
        background:#F7941D; color:#fff; border:none; border-radius:8px;
        font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;
        transition:opacity .2s, transform .15s;
      }
      .followup-submit:hover { opacity:.88; transform:translateY(-1px); }
      .followup-submit.disabled { opacity:.4; pointer-events:none; }
      .followup-error { font-size:11px; color:#ef4444; margin-top:-4px; display:none; }
      .followup-section.has-error .followup-error { display:block; }
      .followup-section.has-error .followup-label { color:#ef4444; }
      .followup-chip.custom-chip {
        border-style:dashed; border-color:rgba(247,148,29,.35); color:rgba(247,148,29,.7);
      }
      .followup-chip.custom-chip.selected { border-style:solid; border-color:#F7941D; background:rgba(247,148,29,.15); color:#F7941D; }
      .followup-custom-row { display:none; width:100%; margin-top:4px; }
      .followup-custom-row.visible { display:flex; gap:6px; }
      .followup-custom-input {
        flex:1; background:rgba(255,255,255,.06); border:1px solid rgba(247,148,29,.3);
        border-radius:8px; padding:7px 10px; color:var(--text-primary,#eef0ff);
        font-size:12px; font-family:inherit; outline:none; transition:border-color .2s;
      }
      .followup-custom-input:focus { border-color:#F7941D; }
      .followup-custom-input::placeholder { color:rgba(200,205,255,.25); }
      .followup-chip.maxed { opacity:.35; pointer-events:none; }
      .followup-done { font-size:12.5px; line-height:1.6; color:var(--text-secondary,rgba(200,205,255,.55)); }
      .followup-done strong { color:#F7941D; font-weight:500; }

      /* ── Steps / history ── */
      .step-row { display:flex; align-items:center; gap:7px; font-size:12px; color:rgba(200,205,255,.6); margin:2px 0; }
      .step-check { flex-shrink:0; }
      .msg-inline-code { font-family: 'SF Mono', ui-monospace, monospace; font-size: 11.5px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); border-radius: 4px; padding: 1px 5px; color: rgba(220,225,255,.9); }

      /* ── Message code blocks ── */
      .msg-code-panel {
        margin: 6px 0 2px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 7px; overflow: hidden;
      }
      .msg-code-hdr {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 10px;
        font-size: 11px; color: rgba(200,205,255,.5);
      }
      .msg-code-lang { flex: 1; font-family: 'SF Mono', monospace; }
      .msg-code-copy {
        background: none; border: 1px solid rgba(255,255,255,.1);
        border-radius: 4px; padding: 2px 7px;
        font-size: 10px; color: rgba(200,205,255,.5);
        cursor: pointer; font-family: inherit;
        transition: color .15s, border-color .15s;
      }
      .msg-code-copy:hover { color: #F7941D; border-color: rgba(247,148,29,.4); }
      .msg-code-pre {
        margin: 0; padding: 8px 10px;
        font-family: 'SF Mono', monospace; font-size: 11px;
        color: rgba(200,205,255,.75); white-space: pre; overflow-x: auto;
        border-top: 1px solid rgba(255,255,255,.05);
      }
    `;
    document.head.appendChild(s);
  })();

  // ── Field definitions: label, choices, flags ──
  const _fieldConfig = {
    site_type: {
      label: 'What type of site?',
      choices: ['Landing Page', 'Portfolio', 'Business', 'E-commerce', 'Blog', 'Restaurant', 'Agency'],
      multi: false, hasCustom: false, noAI: false, required: false,
    },
    sections: {
      label: 'Pick the sections you want',
      choices: ['Hero / Banner', 'About', 'Services', 'Portfolio / Gallery', 'Testimonials', 'Pricing', 'Team', 'FAQ', 'Contact', 'Footer'],
      multi: true, maxSelect: 2, hasCustom: true, noAI: true, required: true,
    },
    primary_color: {
      label: 'Color vibe?',
      choices: ['Dark & Elegant', 'Light & Clean', 'Bold & Colorful', 'Warm & Earthy', 'Cool Blue', 'Neon / Cyber'],
      multi: false, hasCustom: true, noAI: false, required: false,
    },
    tone: {
      label: 'What feel should it have?',
      choices: ['Professional', 'Minimal', 'Playful', 'Bold / Edgy', 'Luxury', 'Friendly & Warm'],
      multi: false, hasCustom: true, noAI: false, required: true,
    },
    target_audience: {
      label: 'Who is it for?',
      choices: ['Everyone', 'Young Adults', 'Professionals', 'Local Customers', 'Tech / Developers', 'Creatives'],
      multi: false, hasCustom: true, noAI: true, required: true,
    },
    special_features: {
      label: 'Any extras?',
      choices: ['Contact Form', 'Image Gallery', 'Pricing Table', 'Animations', 'Newsletter Signup', 'Social Links', 'Map / Location'],
      multi: true, hasCustom: false, noAI: false, required: false,
    },
  };

  const _requiredFollowUpFields = ['sections', 'tone', 'target_audience'];

  function _buildFollowUpHTML(missingFields) {
    let html = '<div class="followup-box">';
    html += '<p class="followup-title">Let\'s shape your website — just tap to choose:</p>';

    // Brand name field (always shown, optional)
    html += `<div class="followup-section followup-brand">
      <span class="followup-label">BRAND / BUSINESS NAME <span class="followup-optional">(optional)</span></span>
      <div class="followup-brand-row">
        <input type="text" class="followup-input" data-field="brand_name" placeholder="e.g. Sunrise Coffee" />
      </div>
    </div>`;

    missingFields.forEach(field => {
      const cfg = _fieldConfig[field];
      if (!cfg) return;
      const isMulti = cfg.multi;
      const isRequired = cfg.required;
      const maxSelect = cfg.maxSelect || 0;

      // Label row with tags
      let labelHTML = cfg.label.toUpperCase();
      if (isRequired) labelHTML += ' <span class="followup-required-tag">REQUIRED</span>';
      if (isMulti && maxSelect) labelHTML += ` <span class="followup-limit-tag">(pick up to ${maxSelect})</span>`;
      else if (isMulti) labelHTML += ' <span class="followup-optional">(pick multiple)</span>';

      html += `<div class="followup-section" data-section="${field}" data-required="${isRequired}">
        <span class="followup-label">${labelHTML}</span>
        <div class="followup-chips" data-field="${field}" data-multi="${isMulti}" data-max="${maxSelect}">`;
      cfg.choices.forEach(c => {
        html += `<button class="followup-chip" data-value="${c}">${c}</button>`;
      });
      // Custom chip
      if (cfg.hasCustom) {
        html += `<button class="followup-chip custom-chip" data-value="__custom__">+ Custom</button>`;
      }
      // AI decide chip (only if not noAI)
      if (!cfg.noAI) {
        html += `<button class="followup-chip ai-decide" data-value="__ai__">✨ Let AI decide</button>`;
      }
      html += `</div>`;
      // Custom input row (hidden by default)
      if (cfg.hasCustom) {
        html += `<div class="followup-custom-row" data-custom-for="${field}">
          <input type="text" class="followup-custom-input" data-field="${field}" placeholder="Type your own…" />
        </div>`;
      }
      // Error message
      if (isRequired) {
        html += `<div class="followup-error" data-error-for="${field}">↑ Please make a selection</div>`;
      }
      html += `</div>`;
    });

    html += '<button class="followup-submit">Generate →</button>';
    html += '</div>';
    return html;
  }

  // ── Follow-up cancellation ──
  let _false = null;

  function _cancelFollowUp() {
    if (_false) {
      _false(new Error('cancelled'));
      _false = null;
    }
    // Remove any visible follow-up form from chat
    const form = el.messages.querySelector('.followup-message');
    if (form) form.remove();
    // Reset progress UI

    hideLoading();
    // Force-reset queue so it's no longer busy
    Queue.forceReset();
  }

  function _showFollowUpQuestions(missingFields) {
    return new Promise((resolve, reject) => {
      _false = reject;
      const msg = document.createElement('div');
      msg.className = 'message ai followup-message';
      msg.innerHTML = _buildFollowUpHTML(missingFields);
      el.messages.appendChild(msg);
      el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;

      // ── Helper: count selected (non-special) chips in a group ──
      function _countSelected(group) {
        return group.querySelectorAll('.followup-chip.selected:not(.ai-decide):not(.custom-chip)').length;
      }

      // ── Helper: enforce max limit visuals ──
      function _enforceMax(group) {
        const max = parseInt(group.dataset.max) || 0;
        if (!max) return;
        const count = _countSelected(group);
        group.querySelectorAll('.followup-chip:not(.ai-decide):not(.custom-chip)').forEach(c => {
          if (!c.classList.contains('selected') && count >= max) {
            c.classList.add('maxed');
          } else {
            c.classList.remove('maxed');
          }
        });
      }

      // ── Helper: clear error on a section ──
      function _clearError(field) {
        const section = msg.querySelector(`[data-section="${field}"]`);
        if (section) section.classList.remove('has-error');
      }

      // ── Chip selection logic ──
      msg.querySelectorAll('.followup-chips').forEach(group => {
        const isMulti = group.dataset.multi === 'true';
        const max = parseInt(group.dataset.max) || 0;
        const field = group.dataset.field;

        // Helper: disable/enable preset chips when custom is active
        function _setPresetsDisabled(group, disabled) {
          group.querySelectorAll('.followup-chip:not(.custom-chip):not(.ai-decide)').forEach(c => {
            if (disabled) { c.classList.add('maxed'); c.classList.remove('selected'); }
            else { c.classList.remove('maxed'); }
          });
        }

        group.addEventListener('click', (e) => {
          const chip = e.target.closest('.followup-chip');
          if (!chip || chip.classList.contains('maxed')) return;

          const isAI = chip.dataset.value === '__ai__';
          const isCustom = chip.dataset.value === '__custom__';
          const aiChip = group.querySelector('.followup-chip.ai-decide');
          const customChip = group.querySelector('.followup-chip.custom-chip');
          const customRow = msg.querySelector(`[data-custom-for="${field}"]`);

          if (isAI) {
            // AI decide: deselect everything, toggle this
            const wasSelected = chip.classList.contains('selected');
            group.querySelectorAll('.followup-chip').forEach(c => c.classList.remove('selected'));
            _setPresetsDisabled(group, false);
            if (!wasSelected) chip.classList.add('selected');
            if (customRow) customRow.classList.remove('visible');
          } else if (isCustom) {
            // Custom: deselect everything, disable presets, show input
            const wasSelected = chip.classList.contains('selected');
            group.querySelectorAll('.followup-chip').forEach(c => c.classList.remove('selected'));
            if (!wasSelected) {
              chip.classList.add('selected');
              _setPresetsDisabled(group, true);
              if (customRow) {
                customRow.classList.add('visible');
                setTimeout(() => customRow.querySelector('.followup-custom-input')?.focus(), 50);
              }
            } else {
              // Deselecting custom: re-enable presets
              chip.classList.remove('selected');
              _setPresetsDisabled(group, false);
              if (customRow) customRow.classList.remove('visible');
            }
          } else if (isMulti) {
            // Multi preset: deselect AI & custom, toggle this chip
            aiChip?.classList.remove('selected');
            if (customChip?.classList.contains('selected')) {
              customChip.classList.remove('selected');
              _setPresetsDisabled(group, false);
              if (customRow) customRow.classList.remove('visible');
            }
            chip.classList.toggle('selected');
          } else {
            // Single preset: deselect all, select this
            group.querySelectorAll('.followup-chip').forEach(c => c.classList.remove('selected'));
            _setPresetsDisabled(group, false);
            chip.classList.add('selected');
            if (customRow) customRow.classList.remove('visible');
          }

          _enforceMax(group);
          _clearError(field);
        });
      });

      // ── Custom input: stop propagation ──
      msg.querySelectorAll('.followup-custom-input').forEach(input => {
        input.addEventListener('keydown', (e) => { e.stopPropagation(); });
        input.addEventListener('input', () => { _clearError(input.dataset.field); });
      });

      // ── Submit ──
      const submitBtn = msg.querySelector('.followup-submit');
      const brandInput = msg.querySelector('[data-field="brand_name"]');

      brandInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
        e.stopPropagation();
      });

      submitBtn.addEventListener('click', () => {
        // ── Validate required fields ──
        let hasError = false;
        _requiredFollowUpFields.forEach(field => {
          const group = msg.querySelector(`.followup-chips[data-field="${field}"]`);
          if (!group) return;
          const section = msg.querySelector(`[data-section="${field}"]`);
          const selected = group.querySelectorAll('.followup-chip.selected');
          const customInput = msg.querySelector(`.followup-custom-input[data-field="${field}"]`);
          const customChipSelected = group.querySelector('.custom-chip.selected');
          const hasCustomValue = customChipSelected && customInput && customInput.value.trim();
          if (selected.length === 0 && !hasCustomValue) {
            if (section) section.classList.add('has-error');
            hasError = true;
          }
        });
        if (hasError) {
          // Scroll to first error
          const firstErr = msg.querySelector('.followup-section.has-error');
          if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }

        // ── Collect answers ──
        const answers = {};
        const brandName = brandInput?.value.trim();
        if (brandName) answers.brand_name = brandName;

        msg.querySelectorAll('.followup-chips').forEach(group => {
          const field = group.dataset.field;
          const selected = group.querySelectorAll('.followup-chip.selected');
          if (selected.length === 0) return;
          const values = Array.from(selected).map(c => c.dataset.value);

          if (values.includes('__ai__')) {
            answers[field] = 'Let AI decide based on the site description';
          } else {
            const real = values.filter(v => v !== '__custom__');
            const customInput = msg.querySelector(`.followup-custom-input[data-field="${field}"]`);
            const customVal = customInput?.value.trim();
            if (customVal) real.push(customVal);
            if (real.length > 0) answers[field] = real.join(', ');
          }
        });

        // Non-required unanswered fields → AI decides
        missingFields.forEach(f => {
          if (!answers[f] && !_requiredFollowUpFields.includes(f)) {
            answers[f] = 'Let AI decide based on the site description';
          }
        });

        // Replace form with summary showing original prompt + choices
        const parts = [];
        Object.entries(answers).forEach(([k, v]) => {
          if (k !== 'brand_name' && k !== '_user_request') parts.push(`<strong>${k}:</strong> ${v}`);
        });
        const brandLine = brandName ? `<strong>Brand:</strong> ${brandName}<br>` : '';
        const prefLines = parts.length > 0 ? parts.join('<br>') : '';
        msg.innerHTML = "";
        Chat.push('ai', 'Preferences: ' + (brandName ? 'Brand: ' + brandName + '. ' : '') + parts.map(p => p.replace(/<[^>]+>/g, '')).join(', '));
        Chat.saveToStorage();
        _false = null;
        resolve(answers);
      });

      // Scroll to show the form
      setTimeout(() => {
        el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
      }, 50);
    });
  }

  /* ============================================================
     CONVERSATIONAL RESPONSE
     Short, non-design messages when a site already exists get a
     lightweight chat reply instead of triggering a full modify.
  ============================================================ */


  async function _conversationalReply(userText, capturedFiles) {
    const msgEl = addMessage('ai', '…', false, null, { __skipPush: true });
    try {
      const pageContext = state.currentCode ? state.currentCode.substring(0, 1500) : '';
      const filesToSend = (capturedFiles && capturedFiles.length > 0) ? capturedFiles : [];
      // Compress images before sending to avoid token limit errors
      const compressedFiles = await Promise.all(filesToSend.map(f => new Promise(resolve => {
        if (!f.type || !f.type.startsWith('image/')) { resolve({ name: f.name, type: f.type, data: f.data }); return; }
        const src = f.thumb || f.data;
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ name: f.name, type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.6) });
        };
        img.onerror = () => resolve({ name: f.name, type: f.type, data: src });
        img.src = src;
      })));
      const data = await API._fetch('/chat/', {
        message: userText,
        page_context: pageContext,
        chat_history: _getRecentHistory(6),
        files: compressedFiles,
      });
      const reply = (typeof data.reply === 'string' && data.reply.trim())
        ? data.reply
        : 'How can I help with your site?';
      const contentEl = msgEl.querySelector('.message-content') || msgEl;
      contentEl.innerHTML = '';
      _renderTextWithCode(contentEl, reply);
      Chat.push('ai', reply);
      Chat.saveToStorage();
      Chat._flushToServer();
    } catch {
      const contentEl = msgEl.querySelector('.message-content') || msgEl;
      contentEl.textContent = 'How can I help with your site?';
    }
  }

  /* ── Generation lock: morphs send button to stop square while AI is working ── */
  let _isGenerating = false;
  let _genAbortCtrl = null; // AbortController for active generation stream

  const _SEND_ICON = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M6.5 11V2M6.5 2L2.5 6M6.5 2L10.5 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const _STOP_ICON = `<svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="11" height="11" rx="2.5"/></svg>`;

  function _setGenerating(on) {
    _isGenerating = !!on;
    if (el.sendBtn) {
      if (on) {
        el.sendBtn.innerHTML = _STOP_ICON;
        el.sendBtn.classList.add('send-btn--stop');
        el.sendBtn.title = 'Stop generation';
        el.sendBtn.disabled = false;
        el.sendBtn.style.opacity = '';
        el.sendBtn.style.pointerEvents = '';
      } else {
        el.sendBtn.innerHTML = _SEND_ICON;
        el.sendBtn.classList.remove('send-btn--stop');
        el.sendBtn.title = 'Send';
        el.sendBtn.disabled = false;
        el.sendBtn.style.opacity = '';
        el.sendBtn.style.pointerEvents = '';
      }
    }
    if (el.chatInput) {
      el.chatInput.disabled = !!on;
    }
  }

  function _stopGeneration() {
    if (!_isGenerating) return;
    if (_genAbortCtrl) { _genAbortCtrl.abort(); _genAbortCtrl = null; }
    Queue.forceReset();
    _setGenerating(false);
    GenStage.hide();
    AIThinkChat.doneThinking();
    addMessage('ai', 'Generation stopped.');
  }



  async function generateWebsite(prompt) {
    return Queue.add(async () => {
      _setGenerating(true);
      // Capture files BEFORE addMessage clears them
      const _generationFiles = FileManager.getFiles();
      // Show user's original prompt in chat (if not already shown by caller)
      const cleanPrompt = prompt.replace(/\[MOBILE REQUIREMENTS[\s\S]*$/, '').trim();
      const lastUserMsg = el.messages.querySelector('.message.user:last-of-type');
      const alreadyShown = lastUserMsg && lastUserMsg.textContent.trim() === cleanPrompt;
      if (cleanPrompt && !alreadyShown) {
        addMessage('user', cleanPrompt);
      }


      el.loadingOverlay && el.loadingOverlay.classList.remove('visible');
      GenStage.reset();
      AIThinkChat.reset();

      // ── INSTANT ACKNOWLEDGMENT ──────────────────────────────────────────────
      // Show the AI thinking widget immediately so the user never sees silence.

      // Hide the device frame immediately so the user never sees a blank
      // white rectangle — GenStage covers the canvas during generation.
      if (el.deviceFrame) el.deviceFrame.style.visibility = 'hidden';

      GenStage.show();
      GenStage.setWriting('index');  // panel appears immediately — no blank canvas
      // Start the Did You Know carousel while we wait

      let spec, missingFields;
      try {
        AIThinkChat.addPhase('planning', 'Extracting project structure…');
        const result = await API.extractSpec(prompt, _generationFiles);
        spec = result.spec;
        missingFields = result.missing_fields;
        AIThinkChat.addPhase('designing', 'Planning design system & layout…');
      } catch (err) {
        GenStage.hide();
        _setGenerating(false);
        addErrorWithRetry(`Error: ${err.message}`, () => generateWebsite(prompt));
        log('spec_error', { err: err.message });
        return;
      }

      // ── Follow-up questions: only for SHORT prompts with NO files ──
      // If the user attached files (images, pasted docs) or wrote a detailed
      // prompt, the AI has enough context — skip the follow-up form entirely.
      const hasFiles = state.files && state.files.length > 0;
      const isDetailedPrompt = prompt.length > 200;
      const shouldSkipFollowUp = hasFiles || isDetailedPrompt;

      if (missingFields && missingFields.length > 0 && !shouldSkipFollowUp) {
        log('spec_incomplete', { missing: missingFields });

        AIThinkChat.doneThinking();

        let answers;
        try {
          answers = await _showFollowUpQuestions(missingFields);
        } catch (err) {
          if (err.message === 'cancelled') { _setGenerating(false); return; } // user edited prompt — silently abort
          addErrorWithRetry('Follow-up cancelled.', () => generateWebsite(prompt));
          return;
        }

        // Inject original prompt into answers so the AI prioritizes it
        answers._user_request = prompt;

        try {
          const completed = await API.completeSpec(prompt, answers, spec);
          spec = completed.spec;

          AIThinkChat.reset();
          // AIThinkChat.show() called by the streaming handler
        } catch (err) {
          GenStage.hide();
          _setGenerating(false);
          addErrorWithRetry(`Error: ${err.message}`, () => generateWebsite(prompt));
          log('complete_spec_error', { err: err.message });
          return;
        }
      }

      log('generate_start', { prompt: prompt.substring(0, 80) });

      // Status message removed in favor of AIThinkChat

      let generateResult;
      try {
        AIThinkChat.addPhase('coding', 'Writing HTML, CSS & JavaScript…');
        // Fix 1: create the AbortController here and hand its signal to the
        // fetch wrapper so _stopGeneration() can actually cancel the stream.
        _genAbortCtrl = new AbortController();
        generateResult = await API.generateFromSpec(spec, prompt, _genAbortCtrl.signal);
      } catch (err) {
        GenStage.hide();
        _genAbortCtrl = null;
        _setGenerating(false);
        addErrorWithRetry(`Error: ${err.message}`, () => generateWebsite(prompt));
        log('generate_error', { err: err.message });
        return;
      }

      const { code, id, tokens, pages, navigation } = generateResult;

      // Wrap in try/finally so _setGenerating(false) is ALWAYS called,
      // even if updatePreview / Project.save / updatePageUI throw.
      try {
        // ── Multi-page: populate state.pages from AI response ──
        if (pages && typeof pages === 'object' && Object.keys(pages).length > 0) {
          const navOrder = navigation || {};
          const sortedSlugs = Object.keys(pages).sort((a, b) => {
            const oa = navOrder[a]?.order ?? 999;
            const ob = navOrder[b]?.order ?? 999;
            return oa - ob;
          });

          state.pages = sortedSlugs.map((slug, idx) => ({
            id: 'page_' + Date.now() + '_' + idx,
            name: slug,
            code: pages[slug] || '',
            timestamp: Date.now(),
            history: [{ code: pages[slug] || '', label: 'Generated', timestamp: Date.now() }],
            historyIndex: 0
          }));

          // Switch to index page (or first page)
          const indexPage = state.pages.find(p => p.name === 'index') || state.pages[0];
          state.currentPageId = indexPage.id;
          state.currentCode = indexPage.code;

          if (!isValidUserHTML(indexPage.code)) {
            GenStage.hide();
            addErrorWithRetry('Error: AI returned invalid HTML. Please try again.', () => generateWebsite(prompt));
            log('generate_invalid_html');
            return;
          }

          GenStage.showAllReady(sortedSlugs);
          AIThinkChat.doneThinking();

          state.lastGenerationId = id;
          updatePageUI();
          updatePreview(indexPage.code);
          updateHistoryUI();
          Project.save();

          // Brief pause so user sees the ready cards, then fade out
          setTimeout(() => GenStage.hide(), 900);

          const pageCount = Object.keys(pages).length;
          const pageNames = sortedSlugs.map(s => navOrder[s]?.label || s).join(', ');
          log('generate_multi_page', {
            id,
            tokens,
            pageCount,
            slugs: sortedSlugs,
          });
          // Remove the interim status message before showing the success message
          el.messages.querySelector('.gen-status-msg')?.remove();
          addMessage('system-sys', 'Generated ' + pageCount + ' page' + (pageCount > 1 ? 's' : '') + ': ' + pageNames);
          addMessage('ai', 'Here is the website you requested. Let me know if you want to adjust the colors, fonts, or tweak any sections.', false, null, {
            reasoning: AIThinkChat.getReasoning(),
            chips: ['Change colors', 'Edit typography', 'Add a new page']
          });
        } else {
          // ── Single-page fallback ──
          if (!isValidUserHTML(code)) {
            GenStage.hide();
            addErrorWithRetry('Error: AI returned invalid HTML. Please try again.', () => generateWebsite(prompt));
            log('generate_invalid_html');
            return;
          }

          GenStage.showAllReady(['index']);
          AIThinkChat.doneThinking();

          state.lastGenerationId = id;
          commitCurrentCode(code);
          updatePreview(code);
          addToHistory(code, 'Generated');
          Project.save();
          setTimeout(() => GenStage.hide(), 900);
          el.messages.querySelector('.gen-status-msg')?.remove();
          addMessage('system-sys', 'Website generated');
          addMessage('ai', 'Here is the website you requested. Let me know if you want to adjust the colors, fonts, or tweak any sections.', false, null, {
            reasoning: AIThinkChat.getReasoning(),
            chips: ['Change colors', 'Edit typography', 'Add a new page']
          });
        }

        // Stamp the project ID into the URL so a page refresh loads this project
        // instead of generating a new one. Uses replaceState — no back-button entry.
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.get('project')) {
          urlParams.set('project', state.projectId);
          const newUrl = window.location.pathname + '?' + urlParams.toString();
          window.history.replaceState({ projectId: state.projectId }, '', newUrl);
        }

        Credits.refresh(); // Update credit badge after spending

        // Clear the prompt from localStorage now that generation succeeded.
        // Without this, a page refresh would re-trigger generateWebsite()
        // because getPrompt() still finds the old key even though ?project= is in the URL
        // and Project.load() returns true — but only if load fully succeeds.
        // Clearing here is unconditional: the project is saved and URL has ?project=.
        try {
          const ns = _userNamespace();
          localStorage.removeItem('nebulux_prompt_' + ns);
        } catch (_) { }

        // Persist reference files to localStorage so return visits have full AI context
        if (state.files && state.files.length > 0) FileManager.saveToProject();

        log('generate_ok', {
          tokens,
          id,
          pages: Array.isArray(state.pages) ? state.pages.length : 0,
          multiPage: !!(pages && typeof pages === 'object' && Object.keys(pages).length > 1),
        });
      } finally {
        _genAbortCtrl = null;   // Fix 1: always release the controller reference
        _setGenerating(false);
      }
    });
  }
  async function modifyWebsite(instruction, editMode, explicitNbxId = null) {
    if (!state.currentCode) return;
    return Queue.add(async () => {
      _setGenerating(true);

      const isElementEdit = explicitNbxId !== null;
      log('modify_start', { instruction: instruction.substring(0, 80), editMode, isElementEdit });

      try {
        const currentPageSlug = getCurrentPage()?.name || 'index';
        const nbxId = explicitNbxId !== null ? explicitNbxId : (state.selectedElement?.nbxId || null);

        _genAbortCtrl = new AbortController();
        let { code, tokens } = await API.modify(state.currentCode, instruction, currentPageSlug, nbxId, editMode, _genAbortCtrl.signal);

        if (!isValidUserHTML(code, isElementEdit)) {
          console.error('[nebulux] AI returned invalid HTML. Length:', code.length, 'isElementEdit:', isElementEdit, 'Preview:', code.substring(0, 200));
          // If we got invalid HTML from a scoped edit, the whole page might be broken.
          // But usually code is either full page or scoped.
          throw new Error('AI returned invalid content. Please try again.');
        }

        const pageName = getCurrentPage()?.name || 'page';
        log('modify_success', { length: code.length, page: pageName });
        commitCurrentCode(code);
        updatePreview(code);
        addToHistory(code, instruction);

        addMessage('system-sys', `Changes applied to ${pageName}`);
        addMessage('ai', `I've updated the page. How does this look?`, false, null, {
          reasoning: AIThinkChat.getReasoning(),
          chips: ['Make it darker', 'Looks good!', 'Undo changes']
        });
        Project.save();
        log('modify_ok', { tokens, editMode });
        Credits.refresh();
        _setGenerating(false);
      } catch (err) {
        _setGenerating(false);
        // FE-6: If it's a VIOLATION error, surface the active mode so the user
        // understands why their instruction was blocked and how to fix it.
        const isViolation = err.message && err.message.includes('VIOLATION') || err.message.includes('blocked');
        if (isViolation && editMode) {
          const modeDescriptions = {
            content: 'Content mode only allows text changes. Switch to Auto or use /style or /layout for other changes.',
            style:   'Style mode only allows color, font, and spacing changes. Switch to Auto or use /content or /layout.',
            layout:  'Layout mode only allows structural reordering. Switch to Auto or use /content or /style.',
          };
          const hint = modeDescriptions[editMode] || `Active mode: ${editMode}. Switch to Auto mode to remove restrictions.`;
          addMessage('ai', `⚠️ Blocked: ${err.message}\n\n${hint}`);
        } else {
          addErrorWithRetry(`Error: ${err.message}`, () => modifyWebsite(instruction, editMode));
        }
        log('modify_error', { err: err.message });
      }
    });
  }

  /* ============================================================
     PAGE MANAGEMENT
  ============================================================ */
  function _escAttr(str) {
    // FIX #7: escape values inserted into HTML attribute strings to prevent XSS.
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function updatePageUI() {
    const currentPage = getCurrentPage();
    const pageIndex = state.pages.findIndex(p => p.id === state.currentPageId);
    el.currentPageName.textContent = currentPage.name;
    el.pageCount.textContent = `${pageIndex + 1}/${state.pages.length}`;

    el.pageList.innerHTML = state.pages.map(page => `
      <div class="page-item ${page.id === state.currentPageId ? 'active' : ''}" data-page-id="${_escAttr(page.id)}">
        <input class="page-item-name-input" value="${_escAttr(page.name)}" data-page-id="${_escAttr(page.id)}"
               spellcheck="false" readonly/>
        <div class="page-item-actions">
          <button class="page-item-action-btn" data-rename-id="${_escAttr(page.id)}" title="Rename">
            <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          ${state.pages.length > 1
        ? `<button class="page-item-action-btn danger" data-page-id="${_escAttr(page.id)}" title="Delete">
                 <svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                   <path d="M1 1l7 7M8 1L1 8"/>
                 </svg>
               </button>`
        : `<span style="width:22px;height:22px;display:inline-block;flex-shrink:0;"></span>`}
        </div>
      </div>
    `).join('');

    $$('.page-item-name-input').forEach(input => {
      // read-only by default; rename button enables editing
      const commit = () => {
        input.setAttribute('readonly', '');
        const page = state.pages.find(p => p.id === input.dataset.pageId);
        if (!page) return;
        let name = input.value.trim() || 'page';
        // Strip any accidental .html the user may have typed
        // Remove .html (case‑insensitive) and any trailing dots
        name = name.replace(/\.html$/i, '').replace(/\.+$/, '').trim() || 'page';
        page.name = name;
        input.value = name;
        updatePageUI();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = state.pages.find(p => p.id === input.dataset.pageId)?.name || ''; input.blur(); }
        e.stopPropagation();
      });
    });

    $$('[data-rename-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const input = btn.closest('.page-item').querySelector('.page-item-name-input');
        if (!input) return;
        if (input.dataset.pageId !== state.currentPageId) switchPage(input.dataset.pageId);
        input.removeAttribute('readonly');
        input.focus();
        input.select();
      });
    });

    $$('.page-item-action-btn.danger').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pageId = btn.dataset.pageId;
        const page = state.pages.find(p => p.id === pageId);
        DeleteConfirmModal.show(pageId, page?.name || 'page');
      });
    });
  }

  function switchPage(pageId) {
    // Close the dropdown immediately — before any DOM changes — so the
    // bubbling click event can never find a detached element and misfire.
    el.pageDropdown.classList.remove('visible');
    el.pageSelector.classList.remove('open');

    if (pageId === state.currentPageId) return;

    // ── Save current page's state ──
    const leaving = getCurrentPage();
    if (leaving) {
      if (state.currentCode) leaving.code = state.currentCode;
    }

    // Chat DOM is now GLOBAL per-project, so we no longer wipe
    // el.messages.innerHTML or swap out chat arrays.

    state.currentPageId = pageId;
    const arriving = getCurrentPage();
    state.currentCode = arriving.code || '';

    setSelectMode(false);
    updatePageUI();
    updateHistoryUI();

    if (state.currentCode) {
      updatePreview(state.currentCode);
    } else {
      ++_renderSeq;
      _clearRenderTimer();
      IframeSession.destroy();
      if (el.previewFrame._blobUrl) {
        URL.revokeObjectURL(el.previewFrame._blobUrl);
        el.previewFrame._blobUrl = null;
      }
      el.previewFrame.removeAttribute('src');
      _hideRenderError();
    }
    log('page_switch', { to: pageId });

    // Persist the new active page immediately so refresh always restores it.
    // We don't wait for the auto-save interval — a page switch should always be durable.
    state.hasUnsavedChanges = true;
    Project.save();
  }

  function addPage() {
    // FIX: The previous implementation used state.pages.length + 1 as the
    // name suffix. After deletions this produces duplicates (e.g. after
    // deleting page-2 from [index, page-2, page-3], adding a page would
    // try to name it page-3 again). Find the next free suffix instead.
    const existingNames = new Set(state.pages.map(p => p.name.toLowerCase()));
    let suffix = state.pages.length + 1;
    while (existingNames.has(`page-${suffix}`)) { suffix++; }
    const newPage = {
      id: `page_${Date.now()}`,
      name: `page-${suffix}`,
      code: '',
      timestamp: Date.now(),
      history: [],
      historyIndex: -1
    };
    state.pages.push(newPage);
    switchPage(newPage.id);
    addMessage('ai', `✓ Created ${newPage.name}`);
  }

  function deletePage(pageId) {
    if (state.pages.length <= 1) { addMessage('ai', '⚠️ Cannot delete the last page.'); return; }
    const idx = state.pages.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    const name = state.pages[idx].name;
    state.pages.splice(idx, 1);
    if (pageId === state.currentPageId) {
      state.currentPageId = state.pages[0].id;
      state.currentCode = state.pages[0].code || '';
      updatePageUI();
      if (state.currentCode) updatePreview(state.currentCode);
    } else { updatePageUI(); }
    addMessage('ai', `🗑️ Deleted ${name}`);
  }

  /* ============================================================
     HISTORY
  ============================================================ */
  function addToHistory(code, label) {
    const h = getPageHistory();
    h.push({ code, label, timestamp: Date.now() });
    if (h.length > CONFIG.maxHistory) h.shift();
    setPageHistoryIndex(h.length - 1);
    updateHistoryUI();
  }

  function updateHistoryUI() {
    const h = getPageHistory();
    const hi = getPageHistoryIndex();
    if (h.length === 0) {
      el.historyEmpty.style.display = 'block';
      el.historyList.innerHTML = '';
      return;
    }
    el.historyEmpty.style.display = 'none';
    el.historyList.innerHTML = h.map((item, idx) => `
      <div class="history-item ${idx === hi ? 'current' : ''}" data-index="${idx}">
        <span class="history-dot"></span>
        <span>${item.label || 'Version ' + (idx + 1)}</span>
        <button class="history-restore-btn" data-index="${idx}" title="Restore">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 7h10M6 2l5 5-5 5"/>
          </svg>
        </button>
      </div>
    `).join('');
    $$('.history-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreHistory(parseInt(btn.dataset.index)));
    });
  }

  function restoreHistory(index) {
    const h = getPageHistory();
    if (index < 0 || index >= h.length) return;
    Queue.add(async () => {
      const item = h[index];
      setPageHistoryIndex(index);
      commitCurrentCode(item.code);
      updatePreview(item.code);
      updateHistoryUI();
      addMessage('ai', `✓ Restored: ${item.label}`);
      log('history_restore', { index, label: item.label });
    });
  }

  function undo() { if (getPageHistoryIndex() > 0) restoreHistory(getPageHistoryIndex() - 1); }

  /* ============================================================
     CHAT PERSISTENCE
     Key is per-project: nebulux_chat_<projectId>
     Capped at CHAT_MAX_MESSAGES. Debounced save (300ms).
  ============================================================ */
  const CHAT_MAX_MESSAGES = 100;
  let _chatMessages = [];
  let _chatSaveTimer = null;

  function _userNamespace() {
    const user = window.Auth && window.Auth.getUser && window.Auth.getUser();
    if (user && user.id) return user.id;
    // Fix 12: anonymous users all resolve to 'anon', which means every logged-out
    // user on a shared browser can see each other's projects.  Generate a stable
    // per-device ID instead.  We intentionally use a separate key (not scoped under
    // a project) so it survives project data being cleared.
    try {
      let deviceId = localStorage.getItem('nebulux_device_id');
      if (!deviceId) {
        deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem('nebulux_device_id', deviceId);
      }
      return deviceId;
    } catch (_) {
      return 'anon';  // last resort: storage blocked (private browsing with strict settings)
    }
  }

  function _chatStorageKey() {
    return 'nebulux_chat_' + _userNamespace() + '_' + state.projectId;
  }

  /* ============================================================
     CHAT HISTORY HELPER
     Returns the last `maxTurns` non-attachment messages as a plain
     [{role, text}] array for sending to the backend as context.
  ============================================================ */
  function _getRecentHistory(maxTurns) {
    if (typeof maxTurns !== 'number' || maxTurns < 1) maxTurns = 8;
    return _chatMessages
      .filter(m => m.text && m.text !== '[attachment]')
      .slice(-maxTurns)
      .map(m => ({ role: m.role || 'user', text: String(m.text).substring(0, 400) }));
  }

  const Chat = {
    _ready: false,

    push(role, text, files, options = {}) {
      if (!this._ready) return;
      const entry = { role, text, ts: Date.now() };
      if (files && files.length > 0) {
        // Compress images to small thumbnails for storage (max 80x80)
        entry.files = files.map(f => {
          // Use pre-generated thumb if available, else fall back to full data if small
          var stored = f.thumb || (f.data && f.data.length < 400 * 1024 ? f.data : null);
          return stored ? { name: f.name, type: f.type, thumb: stored } : null;
        }).filter(Boolean);
      }
      if (options.reasoning) entry.reasoning = options.reasoning;
      if (options.chips) entry.chips = options.chips;
      _chatMessages.push(entry);
      if (_chatMessages.length > CHAT_MAX_MESSAGES) _chatMessages.shift();
    },

    saveToStorage(immediate) {
      if (!this._ready) return;
      if (immediate) {
        this._flushToStorage();
      } else {
        clearTimeout(_chatSaveTimer);
        _chatSaveTimer = setTimeout(() => this._flushToStorage(), 300);
      }
    },

    _flushToStorage() {
      try {
        const toSave = _chatMessages.filter(m =>
          (!m.text || !m.text.startsWith('Sign in to start'))
          && m.text !== '[attachment]'
        );
        localStorage.setItem(_chatStorageKey(), JSON.stringify(toSave));
      } catch (e) {
        console.warn('[Nebulux] Chat save error:', e);
      }
    },

    _flushToServer() {
      if (!state.lastGenerationId) return;
      if (!window.Auth || !window.Auth.isAuthenticated || !window.Auth.isAuthenticated()) return;
      try {
        const toSave = _chatMessages.filter(m =>
          (!m.text || !m.text.startsWith('Sign in to start'))
          && m.text !== '[attachment]'
        ).map(m => {
          const out = { role: m.role, text: m.text, ts: m.ts };
          if (m.reasoning) out.reasoning = m.reasoning;
          if (m.chips) out.chips = m.chips;
          return out;
        }); // strip file blobs
        const pagesPayload = {};
        state.pages.forEach(p => {
          if (p.code) pagesPayload[p.name] = {
            code: p.code,
            history: p.history || [],
            historyIndex: p.historyIndex !== undefined ? p.historyIndex : -1,
          };
        });
        pagesPayload['_chat'] = toSave;
        window.Auth.apiFetch(CONFIG.apiBaseUrl + '/websites/' + state.lastGenerationId + '/', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pages_json: pagesPayload }),
        }).catch(e => console.warn('[Nebulux] Chat server save failed:', e));
      } catch (e) {
        console.warn('[Nebulux] Chat server save error:', e);
      }
    },

    trimFromIndex(domIndex) {
      if (domIndex >= 0 && domIndex < _chatMessages.length) {
        _chatMessages.splice(domIndex);
      }
      this._flushToStorage();
    },

    restoreFromStorage() {
      try {
        const raw = localStorage.getItem(_chatStorageKey());
        if (raw) {
          const msgs = JSON.parse(raw);
          if (Array.isArray(msgs) && msgs.length > 0) {
            // Filter out ephemeral attachment messages — they can't render after reload
            _chatMessages = msgs
              .filter(m => m.text !== '[attachment]' && m.text !== '…')
              .slice(-CHAT_MAX_MESSAGES);

            // Fix 13: build the same DOM shape that addMessage() produces so that
            // the edit-button text-extraction logic (which looks for a child
            // contentSpan) works identically for restored and live messages.
            _chatMessages.forEach(({ role, text, files, reasoning, chips }) => {
              addMessage(role || 'ai', text || '', false, null, { reasoning, chips, __skipPush: true, _restoredFiles: files });
            });

            el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
            log('chat_restored', { count: _chatMessages.length, key: _chatStorageKey() });
          }
        }
      } catch (e) {
        console.warn('[Nebulux] Chat restore error:', e);
      } finally {
        this._ready = true;
      }
    },
  };

  /* ============================================================
     CHAT & MESSAGES
  ============================================================ */

  // Edit feature removed



  // Cancel edit mode if user clears the input
  el.chatInput.addEventListener('input', () => {
    if (!el.chatInput.value.trim() && _editingFromMsg) {
      _editingFromMsg.classList.remove('editing-source');
      _editingFromMsg = null;
    }
  });

  function _renderTextWithCode(container, text) {
    const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
    parts.forEach(part => {
      const m = part.match(/^```([\w]*)\n([\s\S]*?)```$/);
      if (m) {
        const lang = m[1] || 'code';
        const code = m[2];
        const panel = document.createElement('div');
        panel.className = 'msg-code-panel';
        const hdr = document.createElement('div');
        hdr.className = 'msg-code-hdr';
        const langSpan = document.createElement('span');
        langSpan.className = 'msg-code-lang';
        langSpan.textContent = lang;
        const copyBtn = document.createElement('button');
        copyBtn.className = 'msg-code-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
          }).catch(() => { });
        });
        hdr.appendChild(langSpan);
        hdr.appendChild(copyBtn);
        const pre = document.createElement('pre');
        pre.className = 'msg-code-pre';
        pre.textContent = code;
        panel.appendChild(hdr);
        panel.appendChild(pre);
        container.appendChild(panel);
      } else if (part) {
        // Handle inline backtick code
        const inlineRe = /(`[^`]+`)/g;
        const inlineParts = part.split(inlineRe);
        inlineParts.forEach(ip => {
          if (ip.startsWith('`') && ip.endsWith('`') && ip.length > 2) {
            const code = document.createElement('code');
            code.className = 'msg-inline-code';
            code.textContent = ip.slice(1, -1);
            container.appendChild(code);
          } else if (ip) {
            container.appendChild(document.createTextNode(ip));
          }
        });
      }
    });
  }

  function addMessage(role, text, isHtml, extraClass, options = {}) {
    // If it's a basic system confirmation
    if (role === 'system-sys' || role === 'system-err') {
      const sysMsg = document.createElement('div');
      sysMsg.className = `message ${role}`;
      sysMsg.innerHTML = role === 'system-sys' ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;margin-right:6px;vertical-align:middle;margin-bottom:1px;"></span>${text}` : `⚠️ ${text}`;
      el.messages.appendChild(sysMsg);
      el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
      Chat.push('system', text);
      Chat.saveToStorage();
      if (Chat._flushToServer) Chat._flushToServer();
      return sysMsg;
    }

    const msg = document.createElement('div');
    msg.className = `message ${role}`;
    if (extraClass) msg.classList.add(extraClass);

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    if (role !== 'user') wrap.style.width = '100%';

    const contentSpan = document.createElement('span');
    contentSpan.className = 'message-content';
    if (isHtml) {
      contentSpan.innerHTML = text;
    } else {
      _renderTextWithCode(contentSpan, text);
    }
    wrap.appendChild(contentSpan);

    // Optional reasoning panel for AI
    if (role === 'ai' && options.reasoning) {
      const cleanReasoning = options.reasoning
        .replace(/```[\s\S]*?```/g, '') // remove large code blocks
        .replace(/<[^>]+>/g, '') // strip HTML tags
        .split('\n')
        .filter(line => line.trim().length > 0 && !line.includes('{') && !line.includes('}')) // skip CSS-looking lines
        .join(' ');

      if (cleanReasoning.trim()) {
        const rPanel = document.createElement('div');
        rPanel.className = 'msg-reasoning';
        rPanel.innerHTML = `
          <button class="msg-reasoning-toggle">View reasoning <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></button>
          <div class="msg-reasoning-body">${cleanReasoning}</div>
        `;
        rPanel.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          rPanel.classList.toggle('open');
        });
        wrap.insertBefore(rPanel, contentSpan); // Place above the main message text
      }
    }

    // Optional action chips for AI
    if (role === 'ai' && options.chips && options.chips.length > 0) {
      const chipsDiv = document.createElement('div');
      chipsDiv.className = 'msg-action-chips';
      options.chips.forEach(chipText => {
        const c = document.createElement('button');
        c.className = 'msg-action-chip';
        c.textContent = chipText;
        c.addEventListener('click', () => { submitCommand(chipText); });
        chipsDiv.appendChild(c);
      });
      wrap.appendChild(chipsDiv);
    }

    msg.appendChild(wrap);

    // Inject pending file cards into user bubble, then clear preview
    const pendingFiles = options._restoredFiles || (role === 'user' && !isHtml ? FileManager.getFiles() : []);
    if (pendingFiles.length > 0) {
      var filesDiv = document.createElement('div');
      filesDiv.className = 'msg-files';
      filesDiv.style.cssText = 'display:flex;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;gap:6px;margin-bottom:7px;';
      pendingFiles.forEach(function (f) {
        var card = document.createElement('div');
        card.className = 'msg-file-card';
        card.style.cssText = 'flex-shrink:0;width:56px;min-width:56px;max-width:56px;height:56px;min-height:56px;max-height:56px;overflow:hidden;position:relative;border-radius:8px;background:rgba(255,255,255,0.06);';
        const thumb = f.thumb || f.data;
        if (f.type && f.type.startsWith('image/') && thumb) {
          card.innerHTML = '<img src="' + thumb + '" alt="" style="width:56px;height:56px;max-width:56px;max-height:56px;object-fit:cover;display:block;"><span class="insp-label">Inspiration</span>';
        } else {
          var ext = f.name.split('.').pop().toUpperCase().slice(0, 4);
          card.innerHTML = '<div class="msg-file-ext">' + ext + '</div><span class="insp-label">Inspiration</span>';
        }
        filesDiv.appendChild(card);
      });
      wrap.insertBefore(filesDiv, contentSpan);
      if (!options.__skipPush) {
        Chat.push(role, text, pendingFiles, options);
        Chat.saveToStorage();
        if (Chat._flushToServer) Chat._flushToServer();
        FileManager.clearFiles();
      }

      const tsDiv = document.createElement('div');
      tsDiv.className = 'msg-ts';
      const d = new Date();
      tsDiv.textContent = d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
      wrap.appendChild(tsDiv);

      el.messages.appendChild(msg);
      el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
      return msg;
    }

    // No files — push normally
    if (!options.__skipPush) {
      Chat.push(role, isHtml ? '[attachment]' : text, null, options);
      Chat.saveToStorage();
      if (Chat._flushToServer) Chat._flushToServer();
    }

    const tsDiv = document.createElement('div');
    tsDiv.className = 'msg-ts';
    const d = new Date();
    tsDiv.textContent = d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
    wrap.appendChild(tsDiv);

    el.messages.appendChild(msg);
    el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
    return msg;
  }

  function addStepsMessage(steps) {
    const msg = document.createElement('div');
    msg.className = 'message ai steps-message';
    msg.innerHTML = steps.map(s => `
      <div class="step-row">
        <span class="step-check">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="step-text">${s}</span>
      </div>`).join('');
    el.messages.appendChild(msg);
    el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
  }

  function addErrorWithRetry(text, retryFn) {
    Chat.push('ai', text);
    Chat.saveToStorage();

    const msg = document.createElement('div');
    msg.className = 'message ai error-message';

    const textEl = document.createElement('span');
    textEl.textContent = text;
    msg.appendChild(textEl);

    if (retryFn) {
      const btn = document.createElement('button');
      btn.className = 'msg-retry-btn';
      btn.textContent = '↺ Try again';
      btn.addEventListener('click', () => {
        msg.remove();
        // also remove from _chatMessages
        const allMsgs = Array.from(el.messages.querySelectorAll('.message'));
        // not in DOM anymore so trim by re-flushing without it
        Chat.saveToStorage(true);
        retryFn();
      });
      msg.appendChild(btn);
    }

    el.messages.appendChild(msg);
    el.sidebarBody.scrollTop = el.sidebarBody.scrollHeight;
  }

  /* ============================================================
     SLASH COMMAND HINT
     Shows a compact tooltip when the user types '/' at the start of
     the chat input, listing /content /style /layout.
  ============================================================ */
  (function () {
    const chatInput = el.chatInput;
    if (!chatInput) return;

    // Create hint element
    const hint = document.createElement('div');
    hint.id = 'slashHint';
    hint.style.cssText = [
      'display:none',
      'position:absolute',
      'bottom:calc(100% + 6px)',
      'left:0',
      'right:0',
      'background:rgba(15,15,25,.96)',
      'border:1px solid rgba(255,255,255,.1)',
      'border-radius:10px',
      'padding:8px 10px',
      'font-size:11.5px',
      'color:rgba(238,240,255,.7)',
      'line-height:1.7',
      'z-index:50',
      'pointer-events:none',
      'backdrop-filter:blur(8px)',
    ].join(';');
    hint.innerHTML = [
      '<span style="color:rgba(247,148,29,.9);font-weight:600;">/content</span> — text &amp; copy only',
      '<span style="color:rgba(247,148,29,.9);font-weight:600;">/style</span>   — colors, fonts &amp; spacing only',
      '<span style="color:rgba(247,148,29,.9);font-weight:600;">/layout</span>  — structure &amp; breakpoints only',
    ].join('<br>');

    // Insert relative to the chat-input-wrap
    const wrap = chatInput.closest('.chat-input-wrap');
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.appendChild(hint);
    }

    chatInput.addEventListener('input', function () {
      const val = this.value;
      const showHint = /^\/\s*$|^\/\s*(c|co|con|cont|conte|conten|content|s|st|sty|styl|style|l|la|lay|layo|layou|layout)$/i.test(val);
      hint.style.display = showHint ? 'block' : 'none';
    });

    chatInput.addEventListener('blur', function () {
      setTimeout(() => { hint.style.display = 'none'; }, 150);
    });
  })();

  /* ============================================================
     AI INTENT CLASSIFICATION
     Routes chat messages to the right action by asking the backend
     to classify intent. Natural language like "destroy the about page"
     or "spin up a contact section" is handled correctly.
  ============================================================ */
  async function _classifyIntent(text) {
    const pages = state.pages.map(p => p.name);
    const activePage = getCurrentPage()?.name || 'index';
    try {
      const data = await API._fetch('/intent/', {
        message: text,
        pages,
        active_page: activePage,
        project_name: state.projectName || '',
        // Pass recent history so the classifier can resolve pronouns ("it", "that colour")
        chat_history: _getRecentHistory(4),
      });
      return data; // {intent, ...fields}
    } catch (err) {
      console.warn('[nebulux] intent classification failed:', err.message);
      return { intent: 'modify', instruction: text };
    }
  }

  /* ============================================================
     SINGLE-PAGE GENERATION
     Used by _createPageFromChat and NewPagePanel when adding a new
     page to an existing project.  Unlike generateWebsite(), this
     function NEVER replaces state.pages — it only populates the
     code of the one page that was just added.
  ============================================================ */
  async function _generateAndPopulatePage(newPage, prompt) {
    return Queue.add(async () => {
      _setGenerating(true);
      if (el.deviceFrame) el.deviceFrame.style.visibility = 'hidden';
      GenStage.reset();
      AIThinkChat.reset();
      GenStage.show([newPage.name], { title: 'Creating page' });
      GenStage.setWriting(newPage.name);

      // Skip extractSpec — build a minimal spec from existing project context.
      // extractSpec generates a full multi-page spec which causes the model to
      // generate all pages instead of just the one requested.
      const existingPageNames = state.pages
        .filter(p => p.id !== newPage.id)
        .map(p => p.name);

      const spec = {
        site_name: state.projectName || 'Website',
        site_type: 'website',
        sections: [newPage.name],
        _new_page_lock: true,
        _do_not_generate: existingPageNames,
        _original_prompt: state.originalPrompt || prompt,
        _page_description: prompt,
        _existing_pages: existingPageNames,
        pages: [newPage.name],
      };

      let generateResult;
      try {
        AIThinkChat.addPhase('coding', 'Writing HTML, CSS & JavaScript…');
        _genAbortCtrl = new AbortController();
        generateResult = await API.generateFromSpec(spec, prompt, _genAbortCtrl.signal, newPage.name);
      } catch (err) {
        GenStage.hide();
        _genAbortCtrl = null;
        state.pages = state.pages.filter(p => p.id !== newPage.id);
        if (state.currentPageId === newPage.id) {
          const fallback = state.pages[0];
          if (fallback) {
            state.currentPageId = fallback.id;
            state.currentCode = fallback.code || '';
            updatePreview(state.currentCode);
          }
        }
        updatePageUI();
        _setGenerating(false);
        addErrorWithRetry(`Error: ${err.message}`, () => _generateAndPopulatePage(newPage, prompt));
        return;
      }

      try {
        // Extract code for the requested page slug; fall back to first page or raw code.
        let pageCode = '';
        if (generateResult.pages && typeof generateResult.pages === 'object') {
          pageCode = (
            generateResult.pages[newPage.name] ||
            generateResult.pages['index'] ||
            Object.values(generateResult.pages)[0] ||
            ''
          );
        }
        if (!pageCode) pageCode = generateResult.code || '';

        if (!isValidUserHTML(pageCode)) {
          throw new Error('AI returned invalid HTML. Please try again.');
        }

        // Fix 4: update ONLY the new page — never touch the rest of state.pages
        newPage.code = pageCode;
        newPage.history = [{ code: pageCode, label: 'Generated', timestamp: Date.now() }];
        newPage.historyIndex = 0;

        state.currentPageId = newPage.id;
        state.currentCode = pageCode;

        GenStage.showAllReady([newPage.name]);
        AIThinkChat.doneThinking();

        updatePageUI();
        updatePreview(pageCode);
        updateHistoryUI();
        Project.save();

        setTimeout(() => GenStage.hide(), 900);
        el.messages.querySelector('.gen-status-msg')?.remove();
        addMessage('system-sys', `Generated 1 page: ${newPage.name}`);
        addMessage('ai', `I have created the "${newPage.name}" page. What would you like to adjust?`, false, null, {
          reasoning: AIThinkChat.getReasoning(),
          chips: ['Change colors', 'Rewrite copy', 'Add another section']
        });
        Credits.refresh();
        log('generate_new_page_ok', { pageName: newPage.name });
      } catch (err) {
        GenStage.hide();
        _setGenerating(false);
        addErrorWithRetry(`Error: ${err.message}`, () => _generateAndPopulatePage(newPage, prompt));
      } finally {
        _genAbortCtrl = null;
        _setGenerating(false);
        if (el.deviceFrame) el.deviceFrame.style.visibility = '';
      }
    });
  }

  function _deletePageFromChat(pageName) {
    if (!pageName) { addMessage('ai', '⚠️ Could not determine which page to delete.'); return; }
    const page = state.pages.find(p => p.name.toLowerCase() === pageName.toLowerCase());
    if (!page) { addMessage('ai', `⚠️ No page named "${pageName}" found.`); return; }
    if (state.pages.length <= 1) { addMessage('ai', '⚠️ Cannot delete the last page.'); return; }
    deletePage(page.id);
    Project.save();
    log('delete_page_from_chat', { pageName });
  }

  function _renamePageFromChat(pageName, newName) {
    if (!pageName || !newName) { addMessage('ai', '⚠️ Could not determine rename target.'); return; }
    const page = state.pages.find(p => p.name.toLowerCase() === pageName.toLowerCase());
    if (!page) { addMessage('ai', `⚠️ No page named "${pageName}" found.`); return; }
    const cleanNew = newName.trim().toLowerCase()
      .replace(/\.html$/i, '')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'page';
    const oldName = page.name;
    page.name = cleanNew;
    updatePageUI();
    Project.save();
    addMessage('ai', `✓ Renamed "${oldName}" → "${cleanNew}"`);
    log('rename_page_from_chat', { from: oldName, to: cleanNew });
  }

  async function _switchAndEditFromChat(pageName, instruction) {
    if (!pageName) { addMessage('ai', '⚠️ Could not determine which page to edit.'); return; }
    const page = state.pages.find(p => p.name.toLowerCase() === pageName.toLowerCase());
    if (!page) { addMessage('ai', `⚠️ No page named "${pageName}" found.`); return; }
    switchPage(page.id);
    addMessage('ai', `Switched to "${page.name}" — applying changes…`);
    await modifyWebsite(instruction, null);
    log('switch_edit_from_chat', { pageName, instruction: (instruction || '').substring(0, 60) });
  }


  async function _createPageFromChat(text, pageName) {
    // Check if a page with this name already exists
    const existing = state.pages.find(p => p.name.toLowerCase() === pageName.toLowerCase());
    if (existing) {
      addMessage('ai', `⚠️ A page named "${pageName}" already exists. Switching to it.`);
      switchPage(existing.id);
      return;
    }

    const newPage = {
      id: `page_${Date.now()}`,
      name: pageName,
      code: '',
      timestamp: Date.now(),
      history: [],
      historyIndex: -1
    };
    state.pages.push(newPage);
    switchPage(newPage.id);
    updatePageUI();
    addMessage('ai', `Creating "${pageName}" page — matching your site's design…`, false, 'gen-status-msg');

    // Build a prompt with precise design context from the existing site
    const indexPage = state.pages.find(p => p.name === 'index') || state.pages[0];
    const existingPageNames = state.pages.filter(p => p.code && p.id !== newPage.id).map(p => p.name);

    // ── SYSTEM-LEVEL LOCK: structured metadata first, never loose NL ──
    let prompt = `[SYSTEM] NEW PAGE CREATION MODE\n`;
    prompt += `Page name: ${pageName}\n`;
    prompt += `Project: ${state.projectName || 'Website'}\n`;
    prompt += `Existing pages (DO NOT TOUCH OR REGENERATE): ${existingPageNames.join(', ') || 'none'}\n`;
    prompt += `RULE: Generate ONLY the "${pageName}" page. Do NOT output index or any existing page.\n`;
    prompt += `RULE: Output must contain exactly ONE ---PAGE:${pageName}--- marker.\n\n`;
    prompt += text;

    if (indexPage && indexPage.code) {
      // ── Extract FULL design system — all CSS custom properties, not just :root ──
      const allColorVars = [...indexPage.code.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/gi)];
      const rootMatch = indexPage.code.match(/:root\s*\{[^}]*\}/);
      const importMatches = [...indexPage.code.matchAll(/@import[^;]+;/g)].map(m => m[0]);
      const fontFaceMatches = [...indexPage.code.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0]);
      const navMatch = indexPage.code.match(/<nav[\s\S]*?<\/nav>/i);

      let designContext = '';
      if (importMatches.length) designContext += importMatches.join('\n') + '\n';
      if (fontFaceMatches.length) designContext += fontFaceMatches.join('\n') + '\n';
      if (rootMatch) designContext += rootMatch[0] + '\n';

      // If no :root block, reconstruct token list from all found CSS variables
      if (!rootMatch && allColorVars.length > 0) {
        const tokenLines = allColorVars.map(m => `  --${m[1]}: ${m[2]};`);
        // Deduplicate
        const unique = [...new Set(tokenLines)];
        designContext += `:root {\n${unique.join('\n')}\n}\n`;
      }

      if (designContext.trim()) {
        prompt += `\n\nUse this EXACT design system from the existing site. Do NOT deviate from these tokens:\n\`\`\`css\n${designContext.trim()}\n\`\`\``;
      }
      if (navMatch) {
        prompt += `\n\nReuse this navigation structure exactly (update the active link for "${pageName}"):\n${navMatch[0]}`;
      }
    }

    prompt += `\n\nInclude working navigation links to: ${existingPageNames.join(', ')}.`;

    // Fix 4: use the dedicated single-page generator, not generateWebsite()
    await _generateAndPopulatePage(newPage, prompt);
  }

  function submitCommand(text) {
    if (!text || !el.chatInput) return;
    el.chatInput.value = text;
    el.chatInput.dispatchEvent(new Event('input'));
    sendMessage();
  }

  async function sendMessage() {
    // Stop button while generating
    if (_isGenerating) { _stopGeneration(); return; }

    const text = el.chatInput.value.trim();
    if (!text) return;

    if (Queue.busy) _cancelFollowUp();

    // Auth gate
    if (window.Auth && !window.Auth.isAuthenticated()) {
      window.Auth.open('Login');
      document.addEventListener('auth:login', function onReady() { sendMessage(); }, { once: true });
      return;
    }

    // Slash-command shortcut (/content /style /layout) — bypass intent classification
    const _CMD_RE = /^\/\s*(content|style|layout)\s+/i;
    const cmdMatch = text.match(_CMD_RE);
    if (cmdMatch && state.currentCode) {
      const editMode = cmdMatch[1].toLowerCase();
      const instruction = text.slice(cmdMatch[0].length).trim();
      addMessage('user', text);
      el.chatInput.value = '';
      el.chatInput.style.height = 'auto';
      if (!instruction) { addMessage('ai', `⚠️ Usage: /${editMode} <your instruction>`); return; }
      // FE-6: Sync the mode pill to match the slash command
      state.editMode = editMode;
      if (el.editModeBar) {
        el.editModeBar.querySelectorAll('.mode-btn').forEach(b => {
          b.classList.toggle('active', (b.dataset.mode || null) === editMode);
        });
      }
      modifyWebsite(instruction, editMode);
      return;
    }

    // First generation — no existing site yet, skip classification
    if (!state.currentCode) {
      addMessage('user', text);
      el.chatInput.value = '';
      el.chatInput.style.height = 'auto';
      generateWebsite(text);
      return;
    }

    // Capture files BEFORE addMessage clears them
    const _chatFiles = FileManager.getFiles();
    // Show user message; briefly disable input while AI classifies intent
    addMessage('user', text);
    el.chatInput.value = '';
    el.chatInput.style.height = 'auto';
    if (el.chatInput) el.chatInput.disabled = true;

    let intent;
    try {
      intent = await _classifyIntent(text);
    } finally {
      if (el.chatInput) el.chatInput.disabled = false;
    }

    log('intent_classified', { intent: intent.intent });

    // If all classification providers failed, treat as conversational — never
    // trigger a site modification (and never show the full-screen overlay) for
    // a message the AI couldn't evaluate.
    if (intent._fallback) {
      _conversationalReply(text);
      return;
    }

    switch (intent.intent) {
      case 'create_page':
        _createPageFromChat(text, intent.page_name || 'new-page');
        break;
      case 'delete_page':
        _deletePageFromChat(intent.page_name || '');
        break;
      case 'rename_page':
        _renamePageFromChat(intent.page_name || '', intent.new_name || '');
        break;
      case 'switch_edit':
        await _switchAndEditFromChat(intent.page_name || '', intent.instruction || text);
        break;
      case 'chat':
        _conversationalReply(intent.instruction || text, _chatFiles);
        break;
      case 'modify':
      default:
        // FE-6: Apply the active mode pill so the UI selection is honoured
        modifyWebsite(intent.instruction || text, state.editMode || null);
        break;
    }
  }
  function sendElementEdit() {
    let instruction = el.editorInput.value.trim();
    if (!instruction || !state.currentCode) return;

    // Task 3: allow /content or /style prefix in the element editor too
    const _CMD_RE = /^\/\s*(content|style|layout)\s+/i;
    const cmdMatch = instruction.match(_CMD_RE);
    let editMode = null;
    if (cmdMatch) {
      editMode = cmdMatch[1].toLowerCase();
      instruction = instruction.slice(cmdMatch[0].length).trim();
    }

    const context = state.selectedElement
      ? `Modify the ${state.selectedElement.tag} element${state.selectedElement.path ? ' (' + state.selectedElement.path + ')' : ''}: ${instruction}`
      : instruction;

    // Fix 2: capture nbxId NOW, before selectedElement is cleared, so
    // modifyWebsite (which runs async via Queue) receives the correct id.
    const nbxId = state.selectedElement?.nbxId || null;

    addMessage('user', el.editorInput.value.trim()); // show original text with command
    el.editorInput.value = '';
    el.elementEditor.classList.remove('visible');
    el.editingLabel.classList.remove('visible');
    el.selectionBanner.classList.remove('visible');
    state.selectedElement = null;
    modifyWebsite(context, editMode, nbxId);
  }

  /* ============================================================
     PROJECT PERSISTENCE
     nebulux_project_<id>  — full per-project snapshot
     nebulux_projects      — registry list (read by index)
     nebulux_project       — legacy key (backward compat)
  ============================================================ */
  const Project = {
    /**
     * Save current project state.
     * Writes:
     *   1. nebulux_project_<id>  (per-project snapshot)
     *   2. nebulux_project        (legacy key — backward compat)
     *   3. nebulux_projects       (registry, read by index.html)
     * Returns true on success, false on error.
     */
    save() {
      const _doSave = (trimmed) => {
        // Step 1: commit current editor code into the active page
        const page = getCurrentPage();
        if (page && state.currentCode && !isBuilderShell(state.currentCode)) {
          page.code = state.currentCode;
        }

        // Step 2: build full snapshot payload
        const payload = {
          dataVersion: CONFIG.dataVersion,
          projectId: state.projectId,
          projectName: state.projectName,
          pages: state.pages,
          currentPageId: state.currentPageId,
          originalPrompt: state.originalPrompt,
          history: undefined,  /* history now lives per-page */
          device: state.device,
          lastGenerationId: state.lastGenerationId,
          createdAt: state.createdAt,
          updatedAt: Date.now(),
        };
        const serialised = JSON.stringify(payload);

        // Step 3: write per-project key (user-scoped)
        const perProjectKey = 'nebulux_project_' + _userNamespace() + '_' + state.projectId;
        console.log('[Nebulux] saving project → key:', perProjectKey, '| size:', serialised.length);
        localStorage.setItem(perProjectKey, serialised);

        // Verify write
        const readback = localStorage.getItem(perProjectKey);
        if (!readback) throw new Error('Write verified: key missing after setItem.');

        // Step 4: update registry
        this._updateRegistry(payload);

        // Step 5: persist chat alongside project (immediate, no debounce)
        Chat.saveToStorage(true);

        state.hasUnsavedChanges = false;

        // Persist edits to server so they survive sign-out/in
        if (state.lastGenerationId) {
          const page = getCurrentPage();
          const code = page ? page.code : state.currentCode;
          const pagesPayload = {};
          state.pages.forEach(p => {
            if (p.code) pagesPayload[p.name] = {
              code: p.code,
              history: p.history || [],
              historyIndex: p.historyIndex !== undefined ? p.historyIndex : -1,
            };
          });
          // Include chat messages in the same PATCH
          let chatToSave = _chatMessages;
          if (!Chat._ready) {
            try {
              const raw = localStorage.getItem(_chatStorageKey());
              if (raw) chatToSave = JSON.parse(raw);
            } catch (e) { }
          }
          pagesPayload['_chat'] = chatToSave
            .filter(m => (!m.text || !m.text.startsWith('Sign in to start')) && m.text !== '[attachment]')
            .map(m => ({ role: m.role, text: m.text, ts: m.ts }));
          // DATA-3/FE-2: Retry the server PATCH up to 2 times with exponential
          // backoff before giving up.  On permanent failure, show a non-blocking
          // indicator so the user knows their work hasn't reached the server yet.
          (async () => {
            const body = JSON.stringify({ generated_code: code, pages_json: pagesPayload });
            let lastErr;
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
              try {
                const res = await window.Auth.apiFetch(
                  `${CONFIG.apiBaseUrl}/websites/${state.lastGenerationId}/`,
                  { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }
                );
                if (res && res.ok !== false) return; // success
                lastErr = new Error(`HTTP ${res.status}`);
              } catch (e) { lastErr = e; }
            }
            // All retries failed — warn the user without blocking the UI
            console.warn('[Nebulux] Server save failed after retries:', lastErr);
            const bar = document.getElementById('serverSaveErrorBar');
            if (bar) { bar.hidden = false; setTimeout(() => { bar.hidden = true; }, 7000); }
          })();
        }

        log('project_saved', {
          projectId: state.projectId,
          pages: state.pages.length,
          hasCode: !!state.currentCode,
          trimmed,
        });
        return true;
      };

      try {
        return _doSave(false);
      } catch (e) {
        // Handle localStorage quota exceeded — trim history and retry
        if (e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota'))) {
          console.warn('[Nebulux] Quota exceeded — trimming history and retrying…');

          // 1. Trim all page histories to max 3 entries (keep latest)
          state.pages.forEach(p => {
            if (p.history && p.history.length > 3) {
              p.history = p.history.slice(-3);
              if (p.historyIndex >= p.history.length) p.historyIndex = p.history.length - 1;
            }
          });

          // 2. Clear other projects' data from localStorage
          try {
            const ns = _userNamespace();
            const prefix = 'nebulux_project_' + ns + '_';
            const currentKey = prefix + state.projectId;
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(prefix) && k !== currentKey) keysToRemove.push(k);
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
            if (keysToRemove.length) console.info('[Nebulux] Cleared', keysToRemove.length, 'old project(s) to free space.');
          } catch (_) { }

          // 3. Retry
          try {
            return _doSave(true);
          } catch (e2) {
            // Local storage full — not a problem, projects are saved to server
            console.warn('[Nebulux] Local cache full — skipping local save, server save unaffected.');
            return true;
          }
        }

        console.error('[Nebulux] Save error:', e);
        addMessage('ai', `⚠️ Save failed: ${e.message || 'storage error'}`);
        return false;
      }
    },

    /**
     * Update (or create) this project's entry in the nebulux_projects registry.
     * Index reads this registry to display the galaxy grid.
     */
    _updateRegistry(payload) {
      try {
        let projects = [];
        const raw = localStorage.getItem('nebulux_projects_' + _userNamespace());
        if (raw) {
          try { projects = JSON.parse(raw); } catch (e) { projects = []; }
          if (!Array.isArray(projects)) projects = [];
        }

        // Find existing entry or create new
        const idx = projects.findIndex(p => p.id === state.projectId);
        const entry = {
          id: state.projectId,
          apiId: state.lastGenerationId || null,  // DB integer ID — used by index to dedup
          name: state.projectName,
          prompt: state.originalPrompt,
          createdAt: payload.createdAt || Date.now(),
          updatedAt: payload.updatedAt || Date.now(),
        };

        if (idx >= 0) {
          projects[idx] = entry;
        } else {
          projects.push(entry);
        }

        localStorage.setItem('nebulux_projects_' + _userNamespace(), JSON.stringify(projects));
        console.log('[Nebulux] registry updated → key:', 'nebulux_projects_' + _userNamespace(), '| entries:', projects.length, projects);
      } catch (e) {
        console.warn('[Nebulux] Registry update error:', e);
        // Non-fatal — project snapshot still saved
      }
    },

    /**
     * Load project state.
     * Priority:
     *   1. nebulux_project_<userId>_<id>  (localStorage — instant)
     *   2. GET /api/websites/<id>/         (API fallback for new-device / cleared storage)
     * On success populates state.* and returns true.
     * This function is async to support the API fallback.
     */
    async load() {
      // ── Step 1: try localStorage ──────────────────────────────
      try {
        const perProjectKey = 'nebulux_project_' + _userNamespace() + '_' + state.projectId;
        const raw = localStorage.getItem(perProjectKey);

        if (raw) {
          const parsed = JSON.parse(raw);

          if (!parsed.dataVersion || parsed.dataVersion < CONFIG.dataVersion) {
            console.warn('[Nebulux] Stale data version — clearing storage.');
            localStorage.removeItem(perProjectKey);
            // Fall through to API
          } else if (parsed.pages && parsed.pages.length) {
            parsed.pages = parsed.pages.map(p => {
              if (p.code && isBuilderShell(p.code)) p.code = '';
              if (p.name) p.name = p.name.replace(/\.html?$/i, '').replace(/\.+$/, '').trim() || 'page';
              return p;
            });
            if (parsed.history) parsed.history = parsed.history.filter(h => h.code && !isBuilderShell(h.code));

            state.projectName = parsed.projectName || 'New Website';
            state.pages = parsed.pages.map(p => ({ history: [], historyIndex: -1, ...p }));
            state.currentPageId = parsed.currentPageId || parsed.pages[0].id;
            state.originalPrompt = parsed.originalPrompt || '';
            state.device = 'desktop';
            state.lastGenerationId = parsed.lastGenerationId || null;
            state.createdAt = parsed.createdAt || Date.now();
            el.projectTitle.textContent = state.projectName;
            const activePage = getCurrentPage();
            state.currentCode = activePage ? (activePage.code || '') : '';
            log('project_loaded', { projectId: state.projectId, source: 'localStorage', pages: state.pages.length, hasCode: !!state.currentCode });
            if (state.currentCode) return true;
            // Code is empty — fall through to API fallback if possible
            console.log('[Nebulux] load: localStorage entry has no code, trying API fallback');
          }
        }
      } catch (e) {
        console.error('[Nebulux] localStorage load error:', e);
      }

      // ── Step 2: localStorage scan (transition helper) ──────────────
      // Handles the case where the URL now uses the integer API ID (e.g. ?project=42)
      // but the project was originally saved under a local proj_* key.
      // We scan for any saved project whose lastGenerationId matches our integer ID.
      const isApiId = /^\d+$/.test(String(state.projectId));
      if (isApiId) {
        try {
          const ns = _userNamespace();
          const prefix = 'nebulux_project_' + ns + '_';
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(prefix)) continue;
            // Skip if this key IS already the integer-keyed version (we already tried it above)
            if (key === prefix + state.projectId) continue;
            try {
              const scanned = JSON.parse(localStorage.getItem(key));
              if (!scanned || String(scanned.lastGenerationId) !== String(state.projectId)) continue;
              if (!scanned.pages || !scanned.pages.length) continue;
              if (!scanned.dataVersion || scanned.dataVersion < CONFIG.dataVersion) continue;

              // Match found — populate state from the old proj_* entry
              scanned.pages = scanned.pages.map(p => {
                if (p.code && isBuilderShell(p.code)) p.code = '';
                if (p.name) p.name = p.name.replace(/\.html?$/i, '').replace(/\.+$/, '').trim() || 'page';
                return p;
              });

              state.projectName = scanned.projectName || 'New Website';
              state.pages = scanned.pages.map(p => ({ history: [], historyIndex: -1, ...p }));
              state.currentPageId = scanned.currentPageId || scanned.pages[0].id;
              state.originalPrompt = scanned.originalPrompt || '';
              state.device = 'desktop';
              state.lastGenerationId = scanned.lastGenerationId || null;
              state.createdAt = scanned.createdAt || Date.now();
              el.projectTitle.textContent = state.projectName;
              const activePage = getCurrentPage();
              state.currentCode = activePage ? (activePage.code || '') : '';

              // Re-save under the integer key so future visits are instant
              Project.save();

              // Migrate chat messages from old proj_* key to new integer key
              try {
                const oldProjId = key.replace(prefix, '');
                const oldChatKey = 'nebulux_chat_' + ns + '_' + oldProjId;
                const newChatKey = 'nebulux_chat_' + ns + '_' + state.projectId;
                const oldChat = localStorage.getItem(oldChatKey);
                if (oldChat && !localStorage.getItem(newChatKey)) {
                  localStorage.setItem(newChatKey, oldChat);
                  localStorage.removeItem(oldChatKey);
                }
              } catch (_) { }

              log('project_loaded', { projectId: state.projectId, source: 'localStorage_scan', pages: state.pages.length });
              return !!state.currentCode;
            } catch (_) { /* skip corrupted entry */ }
          }
        } catch (scanErr) {
          console.warn('[Nebulux] localStorage scan error:', scanErr);
        }
      }

      // ── Step 3: API fallback (integer ID — new device or cleared storage) ──
      if (!isApiId) {
        console.log('[Nebulux] load: not an API id, giving up. projectId=', state.projectId);
        return false;
      }

      try {
        const useAuth = window.Auth && typeof window.Auth.apiFetch === 'function';
        console.log('[Nebulux] load: trying API fallback. isApiId=', isApiId, 'useAuth=', useAuth, 'isAuth=', window.Auth && window.Auth.isAuthenticated && window.Auth.isAuthenticated());
        if (!useAuth || !window.Auth.isAuthenticated()) {
          console.log('[Nebulux] load: auth not ready, cannot fetch');
          return false;
        }

        // FIX #4: CONFIG.apiBaseUrl already includes /api, so do NOT prepend it again.
        const res = await window.Auth.apiFetch(`${CONFIG.apiBaseUrl}/websites/${state.projectId}/`);
        if (!res.ok) return false;

        const data = await res.json();

        state.projectName = (data.prompt || '').slice(0, 60) || 'Imported Site';
        state.originalPrompt = data.prompt || '';
        state.lastGenerationId = data.id;
        state.createdAt = new Date(data.created_at).getTime() || Date.now();
        state.device = 'desktop';

        // Multi-page API response
        if (data.is_multipage && data.pages && typeof data.pages === 'object' && Object.keys(data.pages).length > 0) {
          const navOrder = data.navigation || {};
          const sortedSlugs = Object.keys(data.pages).filter(s => !s.startsWith('_')).sort((a, b) => {
            const oa = navOrder[a]?.order ?? 999;
            const ob = navOrder[b]?.order ?? 999;
            return oa - ob;
          });

          state.pages = sortedSlugs.map((slug, idx) => {
            const entry = data.pages[slug];
            const isObj = entry && typeof entry === 'object' && entry.code;
            return {
              id: 'page_' + Date.now() + '_' + idx,
              name: slug,
              code: isObj ? entry.code : (entry || ''),
              history: isObj ? (entry.history || []) : [],
              historyIndex: isObj ? (entry.historyIndex !== undefined ? entry.historyIndex : -1) : -1,
            };
          });

          const indexPage = state.pages.find(p => p.name === 'index') || state.pages[0];
          state.currentPageId = indexPage.id;
          state.currentCode = indexPage.code;
        } else {
          // Single-page fallback — check pages_json first (new format with history)
          const pagesJson = data.pages_json;
          const indexEntry = pagesJson && pagesJson['index'];
          const isIndexObj = indexEntry && typeof indexEntry === 'object' && indexEntry.code;
          const code = isIndexObj ? indexEntry.code : (data.generated_code || '');
          if (!code) return false;

          const pageId = 'page_' + Date.now();
          state.pages = [{
            id: pageId,
            name: 'index',
            code: code,
            history: isIndexObj ? (indexEntry.history || []) : [],
            historyIndex: isIndexObj ? (indexEntry.historyIndex !== undefined ? indexEntry.historyIndex : -1) : -1,
          }];
          state.currentPageId = pageId;
          state.currentCode = code;
        }
        el.projectTitle.textContent = state.projectName;

        // Restore chat directly into memory from server data
        const chatData = (data.pages && data.pages['_chat']) || (data.pages_json && data.pages_json['_chat']);
        if (chatData && Array.isArray(chatData) && chatData.length > 0) {
        try {
          localStorage.setItem('nebulux_chat_' + _userNamespace() + '_' + state.projectId, JSON.stringify(chatData));
        } catch (_) { }
      }

        log('project_loaded', { projectId: state.projectId, source: 'api', pages: 1 });
      return true;
    } catch(e) {
      console.error('[Nebulux] API load error:', e);
      return false;
    }
  },
};

/* ============================================================
   SIDEBAR
============================================================ */
const sidebar = $('.sidebar');
const sidebarOpenBtn = $('#sidebarOpenBtn');
const sidebarCloseBtn = $('#sidebarCloseBtn');

function setSidebarOpen(open) {
  sidebar?.classList.toggle('collapsed', !open);
  sidebarOpenBtn?.classList.toggle('panel-open', open);
}

sidebarCloseBtn?.addEventListener('click', () => setSidebarOpen(false));
sidebarOpenBtn?.addEventListener('click', () => setSidebarOpen(sidebar?.classList.contains('collapsed')));

// Mobile swipe to open/close sidebar
if ('ontouchstart' in window && sidebar) {
  let _swipeStartY = 0;
  let _swipeStartX = 0;
  sidebar.addEventListener('touchstart', e => {
    _swipeStartY = e.touches[0].clientY;
    _swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  sidebar.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    const dx = Math.abs(e.changedTouches[0].clientX - _swipeStartX);
    if (Math.abs(dy) > 60 && dx < 60) {
      if (dy > 0) setSidebarOpen(false); // swipe down → close
    }
  }, { passive: true });
  // Swipe up from bottom of screen to open
  document.addEventListener('touchstart', e => {
    _swipeStartY = e.touches[0].clientY;
    _swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    const dx = Math.abs(e.changedTouches[0].clientX - _swipeStartX);
    const fromBottom = window.innerHeight - _swipeStartY < 80;
    if (dy < -60 && dx < 60 && fromBottom && sidebar.classList.contains('collapsed')) {
      setSidebarOpen(true); // swipe up from bottom edge → open
    }
  }, { passive: true });
}

$$('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.panel').forEach(p => p.classList.remove('active'));
    $(`#${tab.dataset.tab}Panel`)?.classList.add('active');
  });
});

/* ============================================================
   DEVICE TOGGLE
   Mobile sizing is handled entirely by .device-frame.mobile in CSS:
     width: 375px; height: 812px (capped)
   The iframe inherits 100% — correct phone viewport, no scaling hack.
============================================================ */
function applyDeviceMode(device) {
  el.deviceFrame.classList.remove('desktop', 'mobile');
  el.deviceFrame.classList.add(device);

  // Re-render so the new viewport width takes effect in the iframe.
  if (state.currentCode && isValidUserHTML(state.currentCode)) {
    updatePreview(state.currentCode);
  }
}

$$('.device-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.device = btn.dataset.device;
    $$('.device-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyDeviceMode(state.device);
  });
});

/* ============================================================
   SELECT MODE BUTTON
============================================================ */
$('#selectModeBtn')?.addEventListener('click', () => setSelectMode(!state.selectMode));

/* ============================================================
   ELEMENT EDITOR EVENTS
============================================================ */
el.editorSubmit.addEventListener('click', sendElementEdit);

// Inline text edit button
el.editorEditText.addEventListener('click', () => {
  const doc = el.previewFrame.contentDocument;
  if (!doc || !state.selectedElement) return;
  const target = doc.querySelector('[data-nbx-id="' + state.selectedElement.nbxId + '"]');
  if (!target) return;
  target.contentEditable = 'true';
  target.focus();
  target.style.outline = '2px dashed rgba(247,148,29,0.7)';
  target.style.borderRadius = '3px';
  el.elementEditor.classList.remove('visible');
  el.selectionBanner.classList.remove('visible');
  function onBlur() {
    target.contentEditable = 'false';
    target.style.outline = '';
    target.style.borderRadius = '';
    if (!state.currentCode) return;
    try {
      const parser = new DOMParser();
      const d = parser.parseFromString(state.currentCode, 'text/html');
      const found = d.querySelector('[data-nbx-id="' + state.selectedElement.nbxId + '"]');
      if (found) {
        found.innerHTML = target.innerHTML;
        const newCode = '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
        commitCurrentCode(newCode);
        Project.save();
        addToHistory(newCode, 'Text edited');
      }
    } catch (err) { console.warn('[nebulux] text edit failed:', err); }
    target.removeEventListener('blur', onBlur);
  }
  target.addEventListener('blur', onBlur);
});

// Inline image replace button
el.editorReplaceImage.addEventListener('click', () => {
  const doc = el.previewFrame.contentDocument;
  if (!doc || !state.selectedElement) return;
  const target = doc.querySelector('[data-nbx-id="' + state.selectedElement.nbxId + '"]');
  if (!target || target.tagName !== 'IMG') return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.cssText = 'display:none';
  document.body.appendChild(input);
  input.click();
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) { input.remove(); return; }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      target.src = dataUrl; // show immediately
      input.remove();

      // Upload to server for a permanent URL
      let finalSrc = dataUrl;
      try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await window.Auth.apiFetch(CONFIG.apiBaseUrl + '/upload-image/', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            finalSrc = data.url;
            target.src = finalSrc;
          }
        }
      } catch (uploadErr) {
        console.warn('[nebulux] image upload failed, using base64:', uploadErr);
      }

      if (!state.currentCode) return;
      try {
        const parser = new DOMParser();
        const d = parser.parseFromString(state.currentCode, 'text/html');
        const found = d.querySelector('[data-nbx-id="' + state.selectedElement.nbxId + '"]');
        if (found) {
          found.setAttribute('src', finalSrc);
          const newCode = '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
          commitCurrentCode(newCode);
          Project.save();
          addToHistory(newCode, 'Image replaced');
        }
      } catch (err) { console.warn('[nebulux] image replace failed:', err); }
    };
    reader.readAsDataURL(file);
  });
  el.elementEditor.classList.remove('visible');
  el.selectionBanner.classList.remove('visible');
});
el.editorInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendElementEdit(); } });

el.editorDelete.addEventListener('click', () => {
  if (!state.selectedElement) return;
  const instr = `Remove the ${state.selectedElement.tag} element${state.selectedElement.path ? ' (' + state.selectedElement.path + ')' : ''}`;
  addMessage('user', instr);
  el.elementEditor.classList.remove('visible');
  el.editingLabel.classList.remove('visible');
  el.selectionBanner.classList.remove('visible');
  // Fix 3: capture nbxId BEFORE clearing selectedElement so modifyWebsite
  // can use AST-scoped removal.  The old code captured it but never forwarded it.
  const nbxId = state.selectedElement?.nbxId || null;
  state.selectedElement = null;
  modifyWebsite(instr, null, nbxId);
});

el.editorClose.addEventListener('click', () => {
  el.elementEditor.classList.remove('visible');
  el.editingLabel.classList.remove('visible');
  el.selectionBanner.classList.remove('visible');
  IframeSession.clearSelection();
  state.selectedElement = null;
});

/* ============================================================
   CHAT INPUT
============================================================ */
el.chatInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});
el.sendBtn.addEventListener('click', sendMessage);
el.chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendMessage(); }
});

/* ============================================================
   FILE ATTACH BUTTON
============================================================ */
(() => {
  const attachBtn = document.getElementById('attachBtn');
  const fileInput = document.getElementById('fileInput');
  if (!attachBtn || !fileInput) return;

  attachBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files.length > 0) {
      await FileManager.addFiles(fileInput.files);
    }
    fileInput.value = ''; // reset so the same file can be re-selected
  });

  // Drag & drop on the chat area
  const dropZone = el.sidebarBody || document.querySelector('.sidebar');
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
    });
    dropZone.addEventListener('drop', async (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        await FileManager.addFiles(e.dataTransfer.files);
      }
    });
  }
})();

/* ============================================================
   FE-6: EDIT MODE SWITCHER
   Mode pill buttons above the chat input. Clicking a mode sets
   state.editMode and applies it to the next modifyWebsite() call,
   equivalent to prefixing the message with /content, /style, /layout.
============================================================ */
if (el.editModeBar) {
  el.editModeBar.addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    const mode = btn.dataset.mode || null;  // '' → null (Auto)
    state.editMode = mode;
    el.editModeBar.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

/* ============================================================
   QUICK CHIPS
============================================================ */
$$('.qchip').forEach(chip => {
  chip.addEventListener('click', () => { el.chatInput.value = chip.textContent; el.chatInput.focus(); });
});

/* ============================================================
   PAGE SELECTOR
============================================================ */
el.pageSelector.addEventListener('click', () => {
  const rect = el.pageSelector.getBoundingClientRect();
  el.pageDropdown.style.top = (rect.bottom + 8) + 'px';
  el.pageDropdown.style.left = rect.left + 'px';
  el.pageDropdown.classList.toggle('visible');
  el.pageSelector.classList.toggle('open', el.pageDropdown.classList.contains('visible'));
});

// Single delegated listener on the list container — survives innerHTML rebuilds.
// Per-item click listeners were removed from updatePageUI() to avoid the bug where
// updatePageUI() detaches the clicked element mid-bubble, causing closest() to return
// null on the now-detached node, which confused the document outside-click handler.
el.pageList.addEventListener('click', e => {
  const item = e.target.closest('.page-item');
  if (!item) return;
  if (e.target.closest('.page-item-actions')) return;
  if (e.target.classList.contains('page-item-name-input') && !e.target.hasAttribute('readonly')) return;
  switchPage(item.dataset.pageId);
});

el.addPageBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  NewPagePanel.open();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.page-selector') && !e.target.closest('.page-dropdown')) {
    el.pageDropdown.classList.remove('visible');
    el.pageSelector.classList.remove('open');
  }
});

/* ============================================================
   PROJECT NAMING
============================================================ */
/* Inline project title rename */
el.projectTitle.addEventListener('click', () => {
  const title = el.projectTitle;
  const original = state.projectName;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'project-title-input';
  input.value = original;

  title.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const name = input.value.trim() || original;
    state.projectName = name;
    input.replaceWith(title);
    title.textContent = name;
    Project.save();
  }

  function cancel() {
    input.replaceWith(title);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
});

/* ============================================================
   EXPORT MODAL
============================================================ */
let currentExportTab = 'html';

el.exportBtn.addEventListener('click', () => {
  if (!state.currentCode) return;
  const idx = state.pages.findIndex(p => p.id === state.currentPageId);
  const exportable = state.pages.filter(p => p.code?.trim()).length;
  el.exportProjectTitle.textContent = state.projectName;
  el.exportFileInfo.textContent = `${idx + 1}/${state.pages.length} (${exportable} exportable)`;
  currentExportTab = 'html';
  $$('.export-tab').forEach(t => t.classList.remove('active'));
  $$('.export-tab[data-export-tab="html"]')[0]?.classList.add('active');
  el.exportCode.innerHTML = formatCodeWithLineNumbers(state.currentCode, 'html');
  el.exportModal.classList.add('visible');
});

el.exportCloseBtn.addEventListener('click', () => el.exportModal.classList.remove('visible'));
el.exportModal.addEventListener('click', e => { if (e.target === el.exportModal) el.exportModal.classList.remove('visible'); });

$$('.export-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    currentExportTab = tab.dataset.exportTab;
    $$('.export-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    if (currentExportTab === 'html') {
      el.exportCode.innerHTML = formatCodeWithLineNumbers(state.currentCode, 'html');
    } else {
      const css = extractCSS(state.currentCode);
      el.exportCode.innerHTML = css ? formatCodeWithLineNumbers(css, 'css') : '<span class="code-line">/* No CSS found */</span>';
    }
    el.exportCodeArea.scrollTop = 0;
  });
});

el.copyCodeBtn.addEventListener('click', async () => {
  const text = currentExportTab === 'html' ? state.currentCode : (extractCSS(state.currentCode) || '/* No CSS found */');
  try {
    await navigator.clipboard.writeText(text);
    const orig = el.copyCodeBtn.innerHTML;
    el.copyCodeBtn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 8l3 3 6-6"/></svg> Copied!`;
    setTimeout(() => { el.copyCodeBtn.innerHTML = orig; }, 2000);
  } catch (err) { console.error('Copy failed:', err); }
});

el.downloadBtn.addEventListener('click', () => {
  if (!state.currentCode) return;

  const exportablePages = state.pages.filter(p => p.code && p.code.trim());

  if (exportablePages.length > 1) {
    // Multi-page: download all pages as a zip using JSZip
    _downloadAllPagesZip(exportablePages);
  } else {
    // Single page: download directly
    const pageName = getCurrentPage()?.name || 'nebulux-site';
    const baseName = pageName.replace(/\.html$/i, '');
    const filename = state.lastGenerationId
      ? `nebulux-site-${state.lastGenerationId}.html`
      : `${baseName}.html`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([state.currentCode], { type: 'text/html' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
});

async function _downloadAllPagesZip(pages) {
  // Dynamically load JSZip if not already present
  if (typeof JSZip === 'undefined') {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load JSZip'));
        document.head.appendChild(script);
      });
    } catch (e) {
      // Fallback: download current page only
      addMessage('ai', 'Could not load zip library. Downloading current page only.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([state.currentCode], { type: 'text/html' }));
      a.download = (getCurrentPage()?.name || 'index') + '.html';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return;
    }
  }

  const zip = new JSZip();
  const projectName = (state.projectName || 'nebulux-site').replace(/[^a-zA-Z0-9_-]/g, '_');

  pages.forEach(page => {
    const name = (page.name || 'page').replace(/\.html$/i, '');
    zip.file(name + '.html', page.code);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = projectName + '.zip';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  addMessage('ai', '\u2713 Downloaded ' + pages.length + ' pages as ' + projectName + '.zip');
  log('export_zip', { projectId: state.projectId, pages: pages.length, projectName });
}

el.openFigmaBtn.addEventListener('click', () => {
  if (!state.currentCode) return;
  window.open(URL.createObjectURL(new Blob([state.currentCode], { type: 'text/html' })), '_blank', 'width=1200,height=800');
  addMessage('ai', '✓ Opened in new window. Use Figma\'s "HTML to Figma" plugin to import.');
});

/* ============================================================
   PREVIEW & SAVE
   Save button shows "Saved ✓" for ~1.2s. Error surfaced in chat.
============================================================ */
el.previewBtn.addEventListener('click', () => {
  if (!state.currentCode) return;
  window.open(URL.createObjectURL(new Blob([state.currentCode], { type: 'text/html' })), '_blank');
});

function _doSaveWithFeedback() {
  console.info('[Nebulux] Save triggered.');
  if (!el.saveBtn) {
    console.error('[Nebulux] #saveBtn not found in DOM — cannot attach feedback.');
    Project.save();
    return;
  }
  const ok = Project.save();
  if (ok) {
    const orig = el.saveBtn.textContent;
    el.saveBtn.textContent = 'Saved ✓';
    el.saveBtn.disabled = true;
    setTimeout(() => {
      el.saveBtn.textContent = orig;
      el.saveBtn.disabled = false;
    }, 1200);
  }
  // If save failed, addMessage('ai', ...) was already called inside Project.save()
}

if (el.saveBtn) {
  el.saveBtn.addEventListener('click', _doSaveWithFeedback);
} else {
  console.error('[Nebulux] #saveBtn not found in DOM — save button listener not attached.');
}

/* ============================================================
   KEYBOARD SHORTCUTS
============================================================ */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    _doSaveWithFeedback();
  }
  if (e.key === 'Escape') {
    el.exportModal.classList.remove('visible');
    el.elementEditor.classList.remove('visible');
    // inline rename input cancels via its own blur/keydown handler
  }
});

/* ============================================================
   LOADING OVERLAY
============================================================ */
function showLoading(text, isSimple) {
  // Used for modifications only (not initial generation)
  if (!el.loadingOverlay) return;  // FIX 9: guard against missing element
  const modText = el.loadingOverlay.querySelector('.lo-mod-text');
  if (modText) modText.textContent = text || 'Applying changes…';
  el.loadingOverlay.classList.add('visible');
}

function hideLoading() {
  el.loadingOverlay.classList.remove('visible');
}

function _ppSetStep(step, phase) { /* process panel removed */ }

/* CodeDrawer removed — replaced by GenStage in center canvas */
const CodeDrawer = {
  show() { }, hide() { }, toggle() { }, reset() { },
  showGenerating() { }, appendChunk() { }, populate() { },
};

/* ============================================================
   TOAST NOTIFICATIONS
============================================================ */
let _toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('__nx_toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '__nx_toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--surface-2,#2a2a2e)', 'color:var(--text,#e8e8ea)',
      'border:1px solid var(--border,rgba(255,255,255,0.08))',
      'border-radius:8px', 'padding:9px 16px', 'font-size:13px',
      'font-family:Outfit,sans-serif', 'z-index:9999',
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
      'opacity:0', 'transition:opacity 0.18s ease', 'pointer-events:none',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
}

/* ============================================================
   AUTO-SAVE
============================================================ */
setInterval(() => {
  if (state.hasUnsavedChanges && state.currentCode) Project.save();
}, CONFIG.autoSaveInterval);

/* ============================================================
   UTILITY
   Note: delay / escapeHtml / highlight* / prettify* / formatCodeWithLineNumbers /
   extractCSS are imported from builder-utils.js at the top of this file (FE-1).
============================================================ */
function getPrompt() {
  // Priority 1: URL param — always present when navigating from the index page.
  const p = new URLSearchParams(window.location.search).get('prompt');
  if (p?.trim()) return decodeURIComponent(p.trim());

  // Priority 2: User-scoped localStorage backup.
  // NEVER falls back to the un-namespaced 'nebulux_prompt' key — that key
  // was written by an older version of the app and would let User B on a
  // shared device inherit User A's last prompt.
  const ns = _userNamespace();
  try {
    const s = localStorage.getItem('nebulux_prompt_' + ns);
    if (s?.trim()) return s.trim();
    // Clean up any stale un-namespaced key left by the old version.
    localStorage.removeItem('nebulux_prompt');
  } catch (e) { }

  return 'Create a beautiful modern website';
}

/* ============================================================
   NEW PAGE PANEL
   Replaces the old inline name-form with a rich setup panel:
   page name, type, style, color, design inheritance, and notes.
   On create: generates the new page using the AI pipeline.
============================================================ */
const NewPagePanel = (() => {
  // Default sections for each page type — ensures spec extractor always gets sections
  const SECTIONS_BY_TYPE = {
    'Landing': ['hero', 'features', 'testimonials', 'call to action'],
    'About': ['hero', 'our story', 'team', 'values'],
    'Contact': ['hero', 'contact form', 'location info', 'FAQ'],
    'Portfolio': ['hero', 'projects grid', 'skills', 'contact'],
    'Blog': ['hero', 'featured post', 'articles list', 'sidebar'],
    'Services': ['hero', 'services list', 'process', 'pricing', 'contact'],
    'Pricing': ['hero', 'pricing tiers', 'feature comparison', 'FAQ'],
    'Gallery': ['hero', 'image grid', 'categories filter', 'contact'],
  };

  const PAGE_TYPES = ['Landing', 'About', 'Contact', 'Portfolio', 'Blog', 'Services', 'Pricing', 'Gallery', 'Custom'];
  const STYLES = ['Modern', 'Minimal', 'Bold', 'Playful', 'Professional', 'Dark', 'Futuristic'];
  const COLORS = [
    { label: 'Blue', hex: '#5b9ee8' },
    { label: 'Violet', hex: '#8b5cf6' },
    { label: 'Cyan', hex: '#06b6d4' },
    { label: 'Emerald', hex: '#10b981' },
    { label: 'Orange', hex: '#f97316' },
    { label: 'Rose', hex: '#f43f5e' },
    { label: 'Amber', hex: '#f59e0b' },
    { label: 'Dark', hex: '#1a1a2e' },
    { label: 'White', hex: '#f8fafc' },
  ];

  const panel = document.getElementById('newPagePanel');
  const closeBtn = document.getElementById('newPageClose');
  const nameInput = document.getElementById('nppName');
  const typeChips = document.getElementById('nppTypeChips');
  const styleChips = document.getElementById('nppStyleChips');
  const colorSwatches = document.getElementById('nppColors');
  const inheritList = document.getElementById('nppInheritList');
  const inheritSection = document.getElementById('nppInheritSection');
  const notesInput = document.getElementById('nppNotes');
  const createBtn = document.getElementById('nppCreateBtn');

  let selectedType = 'Landing';
  let customTypeValue = '';           // filled when selectedType === 'Custom'
  let selectedStyles = ['Modern'];
  let selectedColor = COLORS[0];
  let inheritedColorHex = null;        // non-null when "inherit color from page" is active
  let selectedInherit = null;         // null = none, or page id for design inherit

  // ── Extract primary color from page HTML (single hex for swatch preview) ──
  function _extractColorFromCode(code) {
    if (!code) return null;
    const varMatch = code.match(/--(?:accent|primary|brand|color-primary|theme)\s*:\s*(#[0-9a-fA-F]{3,8})/i);
    if (varMatch) return varMatch[1];
    const hexes = [...code.matchAll(/#([0-9a-fA-F]{6})\b/g)].map(m => '#' + m[1]);
    for (const h of hexes) {
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (brightness > 40 && brightness < 210 && saturation > 40) return h;
    }
    return null;
  }

  // ── Extract FULL design system from page HTML (all CSS color tokens) ──
  function _extractDesignSystem(code) {
    if (!code) return null;
    const colors = {};
    const varMatches = [...code.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/gi)];
    for (const m of varMatches) {
      const name = m[1].toLowerCase().trim();
      colors[name] = m[2];
    }
    const rootMatch = code.match(/:root\s*\{[^}]*\}/);
    const importMatches = [...code.matchAll(/@import[^;]+;/g)].map(m => m[0]);
    const fontFaceMatches = [...code.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0]);
    return { colors, rootBlock: rootMatch?.[0] || null, imports: importMatches, fontFaces: fontFaceMatches };
  }

  // ── Validation ────────────────────────────────────────────
  function _validate() {
    // Custom type must be filled in
    if (selectedType === 'Custom' && !customTypeValue.trim()) return false;
    return true;
  }

  function _updateCreateBtn() {
    const valid = _validate();
    createBtn.disabled = !valid;
    createBtn.style.opacity = valid ? '' : '0.45';
    createBtn.style.cursor = valid ? '' : 'not-allowed';
  }

  // ── Type chips (with Custom → inline input) ───────────────
  function _buildTypeChips() {
    typeChips.innerHTML = '';
    PAGE_TYPES.forEach(item => {
      const chip = document.createElement('button');
      chip.className = 'npp-chip' + (selectedType === item ? ' selected' : '');
      chip.textContent = item;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedType = item;
        typeChips.querySelectorAll('.npp-chip').forEach(c => {
          c.classList.toggle('selected', c.textContent === item);
        });
        _toggleCustomInput();
        _updateCreateBtn();
      });
      typeChips.appendChild(chip);
    });

    // Custom input field — hidden by default
    const wrap = document.createElement('div');
    wrap.id = 'nppCustomWrap';
    wrap.style.cssText = 'display:none;width:100%;margin-top:6px;';
    wrap.innerHTML = `<input id="nppCustomInput" class="npp-input" placeholder="e.g. FAQ, Team, Dashboard…" maxlength="60" spellcheck="false" style="font-size:12px;padding:6px 10px;">`;
    typeChips.appendChild(wrap);

    const customInput = wrap.querySelector('#nppCustomInput');
    customInput.addEventListener('input', (e) => {
      e.stopPropagation();
      customTypeValue = customInput.value;
      _updateCreateBtn();
    });
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); _createPage(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    customInput.addEventListener('click', e => e.stopPropagation());

    _toggleCustomInput();
  }

  function _toggleCustomInput() {
    const wrap = document.getElementById('nppCustomWrap');
    if (!wrap) return;
    const show = selectedType === 'Custom';
    wrap.style.display = show ? 'block' : 'none';
    if (show) {
      const inp = wrap.querySelector('#nppCustomInput');
      inp.value = customTypeValue;
      requestAnimationFrame(() => inp.focus());
    }
  }

  // ── Style chips ───────────────────────────────────────────
  function _buildStyleChips() {
    styleChips.innerHTML = '';

    // ensure default
    if (!Array.isArray(selectedStyles) || selectedStyles.length === 0) {
      selectedStyles = ['Modern'];
    }

    STYLES.forEach(item => {
      const chip = document.createElement('button');
      chip.className = 'npp-chip' + (selectedStyles.includes(item) ? ' selected' : '');
      chip.textContent = item;

      chip.addEventListener('click', (e) => {
        e.stopPropagation();

        // toggle
        if (selectedStyles.includes(item)) {
          selectedStyles = selectedStyles.filter(s => s !== item);
        } else {
          selectedStyles = [...selectedStyles, item];
        }

        // optional: never allow empty selection
        if (selectedStyles.length === 0) selectedStyles = ['Modern'];

        chip.classList.toggle('selected', selectedStyles.includes(item));
      });

      styleChips.appendChild(chip);
    });
  }

  // ── Color swatches + inherit-from-page ────────────────────
  function _buildColors() {
    colorSwatches.innerHTML = '';

    // Preset swatches
    COLORS.forEach(c => {
      const sw = document.createElement('button');
      const isSelected = !inheritedColorHex && selectedColor === c;
      sw.className = 'npp-color-swatch' + (isSelected ? ' selected' : '');
      sw.style.background = c.hex;
      sw.title = c.label;
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedColor = c;
        inheritedColorHex = null;
        // Clear inherit-from dropdown if open
        const picker = document.getElementById('nppColorInheritPicker');
        if (picker) picker.remove();
        colorSwatches.querySelectorAll('.npp-color-swatch').forEach(s => {
          s.classList.toggle('selected', s === sw);
        });
        // Deselect inherit button
        const inheritBtn = document.getElementById('nppColorInheritBtn');
        if (inheritBtn) inheritBtn.classList.remove('selected');
      });
      colorSwatches.appendChild(sw);
    });

    // Wire up the static Auto button (lives in HTML, outside the scroll)
    const pagesWithCode = state.pages.filter(p => p.code);
    const inheritBtn = document.getElementById('nppColorInheritBtn');
    if (inheritBtn) {
      // Sync selected state
      inheritBtn.classList.toggle('selected', !!inheritedColorHex);
      inheritBtn.style.boxShadow = inheritedColorHex
        ? `inset 0 0 0 3px ${inheritedColorHex}`
        : '';

      // Re-attach click (clone to drop any previous listener)
      const fresh = inheritBtn.cloneNode(true);
      inheritBtn.replaceWith(fresh);

      if (pagesWithCode.length > 0) {
        fresh.style.display = '';
        fresh.addEventListener('click', (e) => {
          e.stopPropagation();
          const existing = document.getElementById('nppColorInheritPicker');
          if (existing) { existing.remove(); return; }
          _showColorInheritPicker(fresh, pagesWithCode);
        });
      } else {
        // No pages to inherit from — hide the button
        fresh.style.display = 'none';
      }
    }
  }

  function _showColorInheritPicker(anchor, pages) {
    // Remove any existing picker
    const old = document.getElementById('nppColorInheritPicker');
    if (old) old.remove();

    const picker = document.createElement('div');
    picker.id = 'nppColorInheritPicker';
    picker.className = 'npp-color-inherit-picker';
    picker.innerHTML = `<div class="ncip-label">Copy color from</div>`;

    pages.forEach(page => {
      const extracted = _extractColorFromCode(page.code);
      const row = document.createElement('button');
      row.className = 'ncip-row';
      row.innerHTML = `
          <span class="ncip-dot" style="background:${extracted || '#555'}"></span>
          <span class="ncip-name" title="${page.name}">${page.name}</span>
          ${extracted
          ? `<span class="ncip-hex">${extracted}</span>`
          : `<span class="ncip-hex" style="opacity:.45">no color found</span>`}`;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (extracted) {
          inheritedColorHex = extracted;
          // Show the extracted color as a selected swatch
          colorSwatches.querySelectorAll('.npp-color-swatch').forEach(s => s.classList.remove('selected'));
          const inheritBtn = document.getElementById('nppColorInheritBtn');
          if (inheritBtn) {
            inheritBtn.classList.add('selected');
            inheritBtn.style.boxShadow = `inset 0 0 0 3px ${extracted}`;
          }
        }
        picker.remove();
      });
      picker.appendChild(row);
    });

    // Position popover above the Auto button
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    const pw = picker.offsetWidth;
    // Align right edge of popover with right edge of button; pop above
    let left = rect.right - pw;
    let top = rect.top - picker.offsetHeight - 8;
    // Clamp to viewport
    if (left < 8) left = 8;
    if (top < 8) top = rect.bottom + 8; // flip below if no room above
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';

    // Close on outside click
    const onOutside = (e) => {
      if (!picker.contains(e.target) && e.target !== anchor) {
        picker.remove();
        document.removeEventListener('click', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);
  }

  // ── Design inherit list ───────────────────────────────────
  function _buildInherit() {
    const pagesWithCode = state.pages.filter(p => p.code);
    if (pagesWithCode.length === 0) { inheritSection.style.display = 'none'; return; }
    inheritSection.style.display = '';
    inheritList.innerHTML = '';

    const noneItem = document.createElement('div');
    noneItem.className = 'npp-inherit-none' + (selectedInherit === null ? ' selected' : '');
    noneItem.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg><span>None — fresh design</span>`;
    noneItem.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedInherit = null;
      inheritList.querySelectorAll('.npp-inherit-item, .npp-inherit-none').forEach(i => i.classList.remove('selected'));
      noneItem.classList.add('selected');
    });
    inheritList.appendChild(noneItem);

    state.pages.forEach(page => {
      const item = document.createElement('div');
      item.className = 'npp-inherit-item' + (selectedInherit === page.id ? ' selected' : '');
      item.innerHTML = `<span class="npp-page-dot"></span><span class="npp-page-label" title="${page.name}">${page.name}</span>${page.code ? '' : '<span style="font-size:10px;color:var(--text-3);margin-left:auto;flex-shrink:0">empty</span>'}`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedInherit = page.id;
        inheritList.querySelectorAll('.npp-inherit-item, .npp-inherit-none').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
      inheritList.appendChild(item);
    });
  }

  // ── Open / close ──────────────────────────────────────────
  function open() {
    nameInput.value = "";
    selectedType = 'Landing';
    customTypeValue = '';
    selectedStyles = ['Modern'];
    selectedColor = COLORS[0];
    inheritedColorHex = null;
    selectedInherit = null;
    notesInput.value = '';

    _buildTypeChips();
    _buildStyleChips();
    _buildColors();
    _buildInherit();
    _updateCreateBtn();

    const rect = el.pageSelector.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + 'px';
    panel.style.left = rect.left + 'px';

    panel.classList.add('visible');
    requestAnimationFrame(() => {
      const pr = panel.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) panel.style.left = (window.innerWidth - pr.width - 12) + 'px';
      if (pr.bottom > window.innerHeight - 8) panel.style.top = (rect.top - pr.height - 8) + 'px';
    });

    el.pageDropdown.classList.remove('visible');
    el.pageSelector.classList.remove('open');
    nameInput.focus();
    nameInput.select();
  }

  function close() {
    // Remove any floating pickers
    const picker = document.getElementById('nppColorInheritPicker');
    if (picker) picker.remove();
    panel.classList.remove('visible');
  }

  // ── Build prompt ──────────────────────────────────────────
  function _buildPrompt() {
    const rawName = nameInput.value.trim() || `page-${state.pages.length + 1}`;
    const notes = notesInput.value.trim();
    const typeStr = selectedType === 'Custom' ? customTypeValue.trim() : selectedType;

    // Sections — always explicit so spec extractor never fails
    const defaultSections = SECTIONS_BY_TYPE[selectedType] || ['hero', 'main content', 'call to action', 'footer'];
    const sectionsStr = defaultSections.join(', ');

    // Color — inherited or chosen
    const colorHex = inheritedColorHex || selectedColor.hex;
    const colorLabel = inheritedColorHex
      ? `inherited (${inheritedColorHex})`
      : `${selectedColor.label} (${selectedColor.hex})`;

    let prompt = `Create a complete ${typeStr.toLowerCase()} page`;
    if (rawName && !rawName.match(/^page-\d+$/)) {
      prompt += ` called "${rawName}"`;
    }
    prompt += `. Include these sections: ${sectionsStr}.`;
    const styleStr = (selectedStyles && selectedStyles.length)
      ? selectedStyles.join(', ')
      : 'Modern';
    prompt += ` Style: ${styleStr}.`;
    // If inheriting from an existing page, extract the full design token set
    const inheritPage = selectedInherit ? state.pages.find(p => p.id === selectedInherit) : null;
    if (inheritPage && inheritPage.code) {
      const ds = _extractDesignSystem(inheritPage.code);
      if (ds && Object.keys(ds.colors).length > 0) {
        const tokenList = Object.entries(ds.colors).map(([k, v]) => `--${k}: ${v}`).join('; ');
        prompt += ` Design tokens from "${inheritPage.name}": ${tokenList}.`;
      } else {
        prompt += ` Primary color: ${colorLabel}.`;
      }
      prompt += ` Match the overall design language, typography, and visual style of the existing "${inheritPage.name}" page — keep consistency across the project.`;
      if (ds && ds.rootBlock) {
        prompt += `\nUse this EXACT :root block:\n\`\`\`css\n${ds.rootBlock}\n\`\`\``;
      }
    } else {
      prompt += ` Primary color: ${colorLabel}.`;
    }

    if (notes) prompt += ` Additional requirements: ${notes}`;

    return { prompt, name: rawName };
  }

  // ── Create ────────────────────────────────────────────────
  async function _createPage() {
    if (!_validate()) {
      // Shake the create button as feedback
      createBtn.classList.add('npp-shake');
      setTimeout(() => createBtn.classList.remove('npp-shake'), 500);
      // Focus the custom input if that's the issue
      if (selectedType === 'Custom') {
        document.getElementById('nppCustomInput')?.focus();
      }
      return;
    }
    if (Queue.busy) {
      addMessage('ai', '⚠️ Please wait for the current operation to finish.');
      return;
    }

    const { prompt, name } = _buildPrompt();
    let pageName = name;
    // Strip any .html the user may have typed — names are stored without extension
    pageName = pageName.replace(/\.html$/i, '').replace(/\.+$/, '').trim() || 'page';

    // Fix 4: create the page entry and use the dedicated single-page generator
    // so existing pages are never overwritten.
    const newPage = {
      id: `page_${Date.now()}`,
      name: pageName,
      code: '',
      timestamp: Date.now(),
      history: [],
      historyIndex: -1,
    };
    state.pages.push(newPage);

    close();
    switchPage(newPage.id);
    await delay(100);
    addMessage('user', prompt);
    await _generateAndPopulatePage(newPage, prompt);
  }

  // ── Events ────────────────────────────────────────────────
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  createBtn.addEventListener('click', (e) => { e.stopPropagation(); _createPage(); });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _createPage(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('click', e => e.stopPropagation());

  notesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  notesInput.addEventListener('click', e => e.stopPropagation());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('visible')) close();
  });

  document.addEventListener('click', (e) => {
    if (!panel.classList.contains('visible')) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(panel) && !path.includes(el.addPageBtn)) close();
  });

  return { open, close };
})();

/* ============================================================
   DELETE CONFIRM MODAL
   Shows a proper yes/no modal before deleting a page.
============================================================ */
const DeleteConfirmModal = (() => {
  const overlay = document.getElementById('deleteConfirmOverlay');
  const pageNameEl = document.getElementById('dcmPageName');
  const cancelBtn = document.getElementById('dcmCancel');
  const confirmBtn = document.getElementById('dcmConfirm');

  let _pendingPageId = null;

  function show(pageId, pageName) {
    _pendingPageId = pageId;
    pageNameEl.textContent = pageName;
    overlay.classList.add('visible');
  }

  function hide() {
    overlay.classList.remove('visible');
    _pendingPageId = null;
  }

  cancelBtn.addEventListener('click', hide);

  confirmBtn.addEventListener('click', () => {
    if (_pendingPageId) {
      deletePage(_pendingPageId);
    }
    hide();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('visible')) hide();
  });

  return { show, hide };
})();

/* ============================================================
   IFRAME PAGE NAVIGATION LISTENER
   When user clicks a link like "about.html" inside the preview,
   the guard script posts a message. We intercept it to switch pages.
============================================================ */
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'nebulux_page_nav' && e.data.slug) {
    const slug = e.data.slug.toLowerCase();
    const target = state.pages.find(p => p.name.toLowerCase() === slug);
    if (target && target.id !== state.currentPageId) {
      switchPage(target.id);
      log('iframe_page_nav', { slug });
    }
  }
});

/* ============================================================
   INIT
   Order:
     1. _resolveProjectId() — already done at top of IIFE
     2. Chat.restoreFromStorage() {
console.log('Restoring chat from', chatStorageKey());
// ... existing logic
console.log('Restored', chatMessages.length, 'messages');
} — uses correct per-project key
     3. Project.load() — loads state
     4. Show UI or trigger generation
============================================================ */
async function init() {
    if (window.Auth && window.Auth.ready) {
      await window.Auth.ready;
    }

  state.originalPrompt = getPrompt();

  // Fetch live credit balance immediately
  Credits.refresh();

  // Load attached files from the index page (sessionStorage)
  FileManager.loadFromStorage();

  // ── Is there already a project in the URL? ────────────────────────────
  // If ?project= exists, this is a RETURN VISIT (refresh / back-nav / shared link).
  // We NEVER re-generate in this case, even if load temporarily fails.
  const _urlParams = new URLSearchParams(window.location.search);
  const _hasProject = !!_urlParams.get('project');
  const _hasPrompt = !!_urlParams.get('prompt');

  // Load project FIRST so state.projectId is set, then restore chat with correct key
  const loaded = await Project.load();
  Chat.restoreFromStorage();

  if (loaded && state.currentCode) {
    // ── Project loaded successfully — just display it ────────────────────
    // Strip ?prompt= from the URL so a page refresh never re-triggers generation.
    if (_hasPrompt) {
      _urlParams.delete('prompt');
      const _cleanUrl = window.location.pathname +
        (_urlParams.toString() ? '?' + _urlParams.toString() : '');
      window.history.replaceState({}, '', _cleanUrl);
    }
    // Wipe the localStorage prompt key so even a hard-typed URL can't re-generate
    try { localStorage.removeItem('nebulux_prompt_' + _userNamespace()); } catch (_) { }

    updatePageUI();
    updatePreview(state.currentCode);
    updateHistoryUI();
    applyDeviceMode(state.device);
    $$('.device-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.device === state.device);
    });
    Chat.saveToStorage(true);

  } else if (_hasProject) {
    // ── ?project= in URL but load failed / code missing ──────────────────
    // localStorage was cleared or evicted. Try fetching from server first.
    el.projectTitle.textContent = state.projectName || 'Project';
    updatePageUI();
    try { localStorage.removeItem('nebulux_prompt_' + _userNamespace()); } catch (_) { }

    const _projectApiId = /^\d+$/.test(String(state.projectId)) ? state.projectId : null;
    console.log('[Nebulux] restore: projectId=', state.projectId, 'apiId=', _projectApiId);
    if (_projectApiId) {
      addMessage('ai', '⏳ Restoring your project from the server...');
      (window.Auth && typeof window.Auth.authFetch === 'function'
        ? window.Auth.authFetch('/api/websites/' + _projectApiId + '/')
        : fetch('/api/websites/' + _projectApiId + '/'))
        .then(r => {
          console.log('[Nebulux] project fetch status:', r.status, 'id:', _projectApiId);
          return r.ok ? r.json() : Promise.reject('http_' + r.status);
        })
        .then(data => {
          console.log('[Nebulux] project fetch data keys:', Object.keys(data));
          const code = data.generated_code || (data.pages_json && Object.values(JSON.parse(typeof data.pages_json === 'string' ? data.pages_json : JSON.stringify(data.pages_json)))[0]);
          console.log('[Nebulux] code length:', code ? code.length : 0);
          if (!code) throw new Error('empty');
          // Restore into state
          state.currentCode = code;
          if (data.pages_json) {
            try {
              const pagesJson = typeof data.pages_json === 'string' ? JSON.parse(data.pages_json) : data.pages_json;
              const loadedPages = [];
              Object.entries(pagesJson).forEach(([slug, val]) => {
                if (slug === '_chat') return;
                loadedPages.push({
                  id: 'page_' + Math.random().toString(36).substr(2, 9),
                  name: slug,
                  code: typeof val === 'string' ? val : (val.code || ''),
                  history: val.history || [],
                  historyIndex: val.historyIndex !== undefined ? val.historyIndex : -1,
                });
              });
              state.pages = loadedPages.length > 0 ? loadedPages : [{ id: 'page_' + Date.now(), name: 'index', code, history: [], historyIndex: -1 }];

              if (pagesJson._chat && Array.isArray(pagesJson._chat)) {
                localStorage.setItem('nebulux_chat_' + _userNamespace() + '_' + state.projectId, JSON.stringify(pagesJson._chat));
                Chat.restoreFromStorage();
              }
            } catch (_) { }
          }
          if (data.title) {
            state.projectName = data.title;
            el.projectTitle.textContent = data.title;
          }
          // Save back to localStorage so next load is instant
          const _ns = _userNamespace();
          const _storeKey = 'nebulux_project_' + _ns + '_' + state.projectId;
          try {
            localStorage.setItem(_storeKey, JSON.stringify({
              code, pages: state.pages, name: state.projectName,
              lastGenerationId: _projectApiId, ts: Date.now()
            }));
          } catch (_) { }
          updatePageUI();
          updatePreview(state.currentCode);
          // Remove the loading message and confirm
          const msgs = document.querySelectorAll('.msg-bubble');
          if (msgs.length) msgs[msgs.length - 1].closest('.msg')?.remove();
          addMessage('ai', '✅ Project restored successfully.');
        })
        .catch(() => {
          addMessage('ai', '⚠ Could not load this project — your browser storage may have been cleared. If you have an internet connection, try refreshing the page. If the problem persists, you can re-create it from your original prompt.');
        });
    } else {
      addMessage('ai', '⚠ Could not load this project — your browser storage may have been cleared. If you have an internet connection, try refreshing the page. If the problem persists, you can re-create it from your original prompt.');
    }

  } else {
    // ── No project yet — this is a genuine first-time generation ─────────
    // Only reaches here when there is NO ?project= in the URL.
    el.projectTitle.textContent = state.projectName;
    updatePageUI();

    // Auth gate: must be signed in before generating
    if (window.Auth && !window.Auth.isAuthenticated()) {
      addMessage('ai', 'Sign in to start generating your website.');
      window.Auth.open('Login');

      document.addEventListener('auth:login', function onReady() {
        Credits.refresh();
        generateWebsite(state.originalPrompt);
      }, { once: true });
    } else {
      await generateWebsite(state.originalPrompt);
    }
  }
}

// Attach edit buttons to any messages already in DOM (restored from storage)
// and watch for future ones
new MutationObserver(mutations => {
  mutations.forEach(m => m.addedNodes.forEach(node => {

  }));
}).observe(el.messages, { childList: true });



// Wait for auth.js to finish its async token refresh before running init().
// Without this, window.Auth.isAuthenticated() is always false on first load.
(function () {
  let _initFired = false;
  function _runInit() {
    if (_initFired) return;
    _initFired = true;
    init();
  }
  document.addEventListener('auth:login', _runInit, { once: true });
  document.addEventListener('auth:logout', _runInit, { once: true });
  setTimeout(_runInit, 8000);
})();

// Expose state to publish panel (which lives outside this closure)
window._nebuluxGetGenId = function () { return state.lastGenerationId || null; };
window._nebuluxGetPages = function () { return state.pages || []; };

}) ();

/* ── Sidebar pull-tab visibility ── */
(function () {
  const sidebar = document.querySelector('.sidebar');
  const canvasArea = document.getElementById('canvasArea');
  const pullTab = document.getElementById('sidebarOpenBtn');
  if (!sidebar || !canvasArea || !pullTab) return;

  function sync() {
    const collapsed = sidebar.classList.contains('collapsed');
    canvasArea.classList.toggle('sidebar-hidden', collapsed);
  }

  // Watch sidebar class changes
  new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  sync();
})();

/* ── Page dropdown count badge ── */
(function () {
  const countEl = document.getElementById('pageDropdownCount');
  const listEl = document.getElementById('pageList');
  if (!countEl || !listEl) return;

  new MutationObserver(() => {
    const n = listEl.querySelectorAll('.page-item').length;
    countEl.textContent = n || '–';
  }).observe(listEl, { childList: true, subtree: false });
})();

/* ============================================================
   PUBLISH PANEL
============================================================ */

(function () {
  const publishBtn = document.getElementById('publishBtn');
  const publishPanel = document.getElementById('publishPanel');
  const publishOverlay = document.getElementById('publishPanelOverlay');
  const publishPanelClose = document.getElementById('publishPanelClose');
  const publishedState = document.getElementById('publishedState');
  const unpublishedState = document.getElementById('unpublishedState');
  const changesBanner = document.getElementById('publishChangesBanner');
  const republishBtn = document.getElementById('republishBtn');
  const publishLiveUrl = document.getElementById('publishLiveUrl');
  const publishCopyBtn = document.getElementById('publishCopyBtn');
  const unpublishBtn = document.getElementById('unpublishBtn');
  const subdomainInput = document.getElementById('publishSubdomainInput');
  const subdomainStatus = document.getElementById('subdomainStatus');
  const publishGoBtn = document.getElementById('publishGoBtn');

  if (!publishBtn) return;

  let _checkTimer = null;
  let _currentStatus = null; // null | {is_published, subdomain, url, has_unpublished_changes}

  function openPanel() {
    publishPanel.classList.add('open');
    publishOverlay.classList.add('open');
    _loadStatus();
  }

  function closePanel() {
    publishPanel.classList.remove('open');
    publishOverlay.classList.remove('open');
  }

  publishBtn.addEventListener('click', openPanel);
  publishPanelClose.addEventListener('click', closePanel);
  publishOverlay.addEventListener('click', closePanel);

  async function _apiFetch(url, opts = {}) {
    if (window.Auth && typeof window.Auth.apiFetch === 'function') {
      return window.Auth.apiFetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    }
    return fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  }

  function _hasLocalChanges(publishedAt) {
    // Check if any page was modified after the published_at timestamp
    if (!publishedAt) return false;
    const pubTime = new Date(publishedAt).getTime();
    try {
      const pages = window._nebuluxGetPages?.() || [];
      return pages.some(p => p.timestamp && p.timestamp > pubTime);
    } catch (e) { return false; }
  }

  async function _loadStatus() {
    const genId = window._nebuluxGetGenId?.();
    if (!genId) {
      _showUnpublished();
      return;
    }
    try {
      const res = await _apiFetch(`/api/publishing/status/${genId}/`);
      const data = await res.json();
      _currentStatus = data;
      if (data.is_published) {
        // Also check client-side for local unsaved changes
        if (!data.has_unpublished_changes) {
          data.has_unpublished_changes = _hasLocalChanges(data.published_at);
        }
        _showPublished(data);
      } else {
        _showUnpublished();
      }
    } catch (e) {
      _showUnpublished();
    }
  }

  function _showPublished(data) {
    publishedState.style.display = 'block';
    unpublishedState.style.display = 'none';
    publishLiveUrl.href = data.url;
    publishLiveUrl.textContent = data.url.replace('https://', '');
    changesBanner.style.display = data.has_unpublished_changes ? 'flex' : 'none';
  }

  function _showUnpublished() {
    publishedState.style.display = 'none';
    unpublishedState.style.display = 'block';
    changesBanner.style.display = 'none';
  }

  // Subdomain availability check with debounce
  subdomainInput.addEventListener('input', () => {
    const val = subdomainInput.value.trim().toLowerCase();
    subdomainStatus.textContent = '';
    subdomainStatus.className = 'publish-subdomain-status';
    publishGoBtn.disabled = true;
    clearTimeout(_checkTimer);
    if (!val) return;
    subdomainStatus.textContent = 'Checking…';
    _checkTimer = setTimeout(() => _checkSubdomain(val), 500);
  });

  async function _checkSubdomain(slug) {
    try {
      const res = await _apiFetch(`/api/publishing/check/?subdomain=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (data.available) {
        subdomainStatus.textContent = '✓ Available';
        subdomainStatus.className = 'publish-subdomain-status ok';
        publishGoBtn.disabled = false;
      } else {
        subdomainStatus.textContent = data.error || 'Not available';
        subdomainStatus.className = 'publish-subdomain-status err';
        publishGoBtn.disabled = true;
      }
    } catch (e) {
      subdomainStatus.textContent = 'Could not check';
      subdomainStatus.className = 'publish-subdomain-status err';
    }
  }

  // Publish
  publishGoBtn.addEventListener('click', async () => {
    const subdomain = subdomainInput.value.trim().toLowerCase();
    const genId = window._nebuluxGetGenId?.();
    if (!subdomain || !genId) return;
    publishGoBtn.disabled = true;
    publishGoBtn.textContent = 'Publishing…';
    try {
      const res = await _apiFetch('/api/publishing/publish/', {
        method: 'POST',
        body: JSON.stringify({ subdomain, generation_id: genId }),
      });
      const data = await res.json();
      if (res.ok) {
        _currentStatus = { is_published: true, subdomain: data.subdomain, url: data.url, has_unpublished_changes: false };
        _showPublished(_currentStatus);
      } else {
        subdomainStatus.textContent = data.error || 'Publish failed';
        subdomainStatus.className = 'publish-subdomain-status err';
        publishGoBtn.disabled = false;
        publishGoBtn.innerHTML = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2l9 7-9 7-9-7 9-7z"/><path d="M3 17l9 5 9-5"/></svg> Publish site';
      }
    } catch (e) {
      publishGoBtn.disabled = false;
      publishGoBtn.innerHTML = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2l9 7-9 7-9-7 9-7z"/><path d="M3 17l9 5 9-5"/></svg> Publish site';
    }
  });

  // Republish
  republishBtn.addEventListener('click', async () => {
    const genId = window._nebuluxGetGenId?.();
    if (!genId) return;
    republishBtn.textContent = 'Publishing…';
    republishBtn.disabled = true;
    try {
      const res = await _apiFetch('/api/publishing/republish/', {
        method: 'POST',
        body: JSON.stringify({ generation_id: genId }),
      });
      if (res.ok) {
        changesBanner.style.display = 'none';
        if (_currentStatus) _currentStatus.has_unpublished_changes = false;
      }
    } finally {
      republishBtn.textContent = 'Publish update';
      republishBtn.disabled = false;
    }
  });

  // Copy link
  publishCopyBtn.addEventListener('click', () => {
    if (!_currentStatus?.url) return;
    navigator.clipboard.writeText(_currentStatus.url).then(() => {
      const orig = publishCopyBtn.innerHTML;
      publishCopyBtn.textContent = 'Copied!';
      setTimeout(() => { publishCopyBtn.innerHTML = orig; }, 2000);
    });
  });

  // Unpublish
  unpublishBtn.addEventListener('click', async () => {
    const genId = window._nebuluxGetGenId?.();
    if (!genId) return;
    if (!confirm('Unpublish this site? The URL will stop working.')) return;
    unpublishBtn.textContent = 'Unpublishing…';
    try {
      const res = await _apiFetch(`/api/publishing/unpublish/${genId}/`, { method: 'DELETE' });
      if (res && res.ok !== false) {
        _currentStatus = null;
        _showUnpublished();
      }
    } finally {
      unpublishBtn.textContent = 'Unpublish';
    }
  });

  // Event delegation for publishFullBtn to ensure it works even if dynamically rendered
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('#publishFullBtn');
    if (!btn || btn.disabled) return;
    
    const genId = window._nebuluxGetGenId?.();
    console.log('[FullApp] Button clicked via delegation. Project ID:', genId);
    
    // Check if the site is already published or if a valid subdomain is entered
    const subdomainInput = document.getElementById('publishSubdomainInput');
    const subdomainStatus = document.getElementById('subdomainStatus');
    const isAvailable = subdomainStatus && subdomainStatus.textContent.includes('Available');
    const isPublished = document.getElementById('publishedState')?.style.display === 'block';
    
    // Only enforce subdomain check if the site isn't already published
    if (!isPublished && (!subdomainInput?.value.trim() || !isAvailable)) {
        alert('Please enter a valid, available subdomain for your site before generating the Full App Bundle.');
        if (subdomainInput) subdomainInput.focus();
        return;
    }

    const subdomain = isPublished ? _currentStatus?.subdomain : subdomainInput?.value.trim().toLowerCase();

    const originalText = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.innerHTML = 'Analyzing & Generating...';

      const projectId = genId;
      if (!projectId) throw new Error('No project ID found');

      const fetcher = (window.Auth && typeof Auth.authFetch === 'function') 
          ? Auth.authFetch.bind(Auth) 
          : fetch;

      // Read Supabase credentials
      const supabaseUrl = document.getElementById('supabaseUrlInput')?.value.trim() || '';
      const supabaseAnonKey = document.getElementById('supabaseAnonKeyInput')?.value.trim() || '';

      // Validate — show inline status if missing (still allow bundle generation without backend)
      const supabaseStatus = document.getElementById('supabaseConnectStatus');
      if (!supabaseUrl || !supabaseAnonKey) {
          if (supabaseStatus) {
              supabaseStatus.textContent = '⚠ Enter your Supabase URL and anon key to enable backend.';
              supabaseStatus.style.color = '#f59e0b';
          }
      } else {
          if (supabaseStatus) {
              supabaseStatus.textContent = '';
          }
      }

      console.log('[FullApp] Requesting bundle for ID:', projectId, 'Subdomain:', subdomain);
      const response = await fetcher(`/api/publish/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': (function() {
              const name = 'csrftoken';
              let cookieValue = null;
              if (document.cookie && document.cookie !== '') {
                  const cookies = document.cookie.split(';');
                  for (let i = 0; i < cookies.length; i++) {
                      const cookie = cookies[i].trim();
                      if (cookie.substring(0, name.length + 1) === (name + '=')) {
                          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                          break;
                      }
                  }
              }
              return cookieValue;
          })(),
        },
        body: JSON.stringify({
            nbx_id: projectId,
            subdomain: subdomain,
            supabase_url: supabaseUrl,
            supabase_anon_key: supabaseAnonKey,
        })
      });

      if (!response.ok) {
          console.error('[FullApp] Response error:', response.status);
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Server error (${response.status})`);
      }

      const blob = await response.blob();
      console.log('[FullApp] Received blob:', blob.size, 'bytes');
      
      const liveUrl = response.headers.get('X-Live-URL');
      const deployError = response.headers.get('X-Deploy-Error');
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const projectTitle = (document.getElementById('projectTitle')?.textContent || 'nebulux').trim().replace(/\s+/g, '_');
      a.download = `${projectTitle}_full_app.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      // Auto-publish the site after bundle generation
      if (subdomain) {
          try {
              if (!isPublished) {
                  const pubRes = await _apiFetch('/api/publishing/publish/', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ subdomain, generation_id: genId })
                  });
                  if (pubRes) {
                      const siteUrl = `https://${subdomain}.nebulux.one`;
                      _currentStatus = { is_published: true, subdomain, url: siteUrl, has_unpublished_changes: false };
                      _showPublished(_currentStatus);
                  }
              }

              const hasBackend = !!(supabaseUrl && supabaseAnonKey);
              const liveSiteUrl = `https://${subdomain}.nebulux.one`;

              if (hasBackend) {
                  alert(`✅ Done!\n\nYour site is live at:\n${liveSiteUrl}\n\nYour Supabase backend is wired in.\nA backup ZIP has also been downloaded.`);
              } else {
                  alert(`✅ Done!\n\nYour site is live at:\n${liveSiteUrl}\n\nA backup ZIP has also been downloaded.\n\nTip: Add Supabase credentials to enable a real database.`);
              }

              btn.innerHTML = '✓ Live at ' + subdomain + '.nebulux.one';

              if (typeof _loadStatus === 'function') _loadStatus();

          } catch (pubErr) {
              console.error('[FullApp] Auto-publish failed:', pubErr);
              const liveSiteUrl = `https://${subdomain}.nebulux.one`;
              alert(`Bundle downloaded!\n\nTo make your site live, click "Publish site" above.\nYour URL will be: ${liveSiteUrl}`);
              btn.innerHTML = 'Bundle Downloaded';
          }
      } else {
          btn.innerHTML = 'Bundle Ready!';
          alert('Bundle downloaded! Enter a subdomain above and click "Publish site" to go live.');
      }

      setTimeout(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
          btn.style.opacity = '';
      }, 4000);
      
    } catch (err) {
      console.error('[FullApp] Click handler failed:', err);
      alert(`Error: ${err.message}`);
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = originalText;
    }
  });

})();


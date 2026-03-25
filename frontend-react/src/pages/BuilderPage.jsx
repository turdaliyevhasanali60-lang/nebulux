import React, { useEffect, useRef } from 'react'
import '../styles/builder.css'

// Auth guard — synchronous check before render
const RT_KEY = 'nbx_rt'
if (!localStorage.getItem(RT_KEY)) {
  try { sessionStorage.setItem('nbx_after_login', window.location.href) } catch (_) {}
  window.location.replace('/')
}

export default function BuilderPage() {
  const initedRef = useRef(false)

  useEffect(() => {
    // Set title
    document.title = 'NEBULUX Builder'

    if (initedRef.current) return
    initedRef.current = true

    // Auth guard timer (mirrors original inline script)
    document.documentElement.style.visibility = 'hidden'
    const guardTimer = setTimeout(() => {
      document.documentElement.style.visibility = ''
      const fb = document.getElementById('__auth_fallback')
      if (fb) fb.style.display = 'flex'
      try { sessionStorage.setItem('nbx_after_login', window.location.href) } catch (_) {}
      setTimeout(() => { window.location.replace('/') }, 3000)
    }, 8000)

    const permitEntry = () => { clearTimeout(guardTimer); document.documentElement.style.visibility = '' }
    const denyEntry = () => {
      clearTimeout(guardTimer)
      try { sessionStorage.setItem('nbx_after_login', window.location.href) } catch (_) {}
      window.location.replace('/')
    }

    window.addEventListener('auth:login', permitEntry, { once: true })
    window.addEventListener('auth:guest', denyEntry, { once: true })

    import('../scripts/builder.js')

    return () => {
      window.removeEventListener('auth:login', permitEntry)
      window.removeEventListener('auth:guest', denyEntry)
    }
  }, [])

  return (
    <>
      <div id="serverSaveErrorBar" hidden>⚠️ Changes couldn't reach the server — check your connection and press Save.</div>

      <header className="topbar">
        <div className="topbar-left">
          <a href="/" className="logo-back" title="Back to home">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
              <path d="M9 21V12h6v9"/>
            </svg>
          </a>
          <div className="topbar-divider"></div>
          <span className="project-title" id="projectTitle" title="Click to rename">New Website</span>
        </div>
        <div className="topbar-center">
          <div className="page-selector" id="pageSelector" title="Switch page">
            <span className="page-name" id="currentPageName">index</span>
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 3.5l3 3 3-3"/></svg>
            <span className="page-count" id="pageCount">1/1</span>
          </div>
          <div className="device-group">
            <button className="device-btn active" data-device="desktop" title="Desktop view">
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="1.5" y="2" width="12" height="8.5" rx="1"/>
                <path d="M5 13h5M7.5 10.5v2.5"/>
              </svg>
            </button>
            <button className="device-btn" data-device="mobile" title="Mobile view">
              <svg width="13" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="2" y="1" width="9" height="13" rx="2"/>
                <path d="M6.5 10.5h.01"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="topbar-right">
          <div className="credits-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z"/></svg>
            <span id="creditsCount">– credits</span>
          </div>
          <div className="action-group">
            <button className="action-btn" id="selectModeBtn" title="Select element to edit">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3.5 3.5l7 2.5-3.5 1-1 3.5z"/></svg>
              Select
            </button>
            <button className="action-btn" id="previewBtn" title="Preview in new tab">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 2H2v8h8V6"/><path d="M7 1h4v4"/><path d="M4.5 7.5L11 1"/></svg>
              Preview
            </button>
            <button className="action-btn" id="exportBtn" title="Export code">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 1v7m0 0L4 6m2 2l2-2"/><path d="M1 9v1.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V9"/></svg>
              Export
            </button>
          </div>
          <button className="save-btn" id="saveBtn">Save</button>
          <button className="publish-btn" id="publishBtn" title="Publish site">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2l9 7-9 7-9-7 9-7z"/><path d="M3 17l9 5 9-5"/></svg>
            Publish
          </button>
        </div>
      </header>

      <div className="page-dropdown" id="pageDropdown">
        <div className="page-dropdown-header">
          <span className="page-dropdown-title">Pages</span>
          <span className="page-dropdown-count" id="pageDropdownCount">1</span>
        </div>
        <div className="page-list" id="pageList"></div>
        <div className="page-dropdown-divider"></div>
        <button className="add-page-btn" id="addPageBtn">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5.5 1v9M1 5.5h9"/></svg>
          New Page
        </button>
      </div>

      <div className="workspace">
        <div className="canvas-area" id="canvasArea">
          <button className="sidebar-pull-tab" id="sidebarOpenBtn" title="Open AI panel">
            <img src="/static/img/logo.png" alt="Nebulux" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
          </button>
          <div className="loading-overlay" id="loadingOverlay">
            <div className="lo-mod-wrap">
              <div className="lo-mod-ring"></div>
              <span className="lo-mod-text">Applying changes…</span>
            </div>
          </div>
          <div className="gen-stage" id="genStage" hidden aria-busy="false">
            <div className="neural-core-shell" id="generationShell">
              <div className="nc-orb-wrapper">
                <div className="nc-orb"></div>
                <div className="nc-orb-blur"></div>
                <img src="/static/img/logo.png" className="nc-logo" alt="Logo" style={{ position: 'absolute', width: '65px', height: '65px', objectFit: 'contain', zIndex: 5, filter: 'drop-shadow(0 0 20px rgba(255,255,255,0.3))', animation: 'orbPulse 3s ease-in-out infinite alternate' }} />
              </div>
              <div className="nc-content">
                <h2 className="nc-title" id="genStageTitle">Crafting structure...</h2>
                <p className="nc-subtitle" id="genStageSubtitle">Creating pages in the workspace</p>
              </div>
            </div>
          </div>
          <div className="device-frame desktop" id="deviceFrame">
            <div className="mobile-status-bar" id="mobileStatusBar">
              <div className="dynamic-island"></div>
            </div>
            <iframe id="previewFrame" className="preview-frame"
              sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
          </div>
          <div className="render-error" id="renderError">
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
            </svg>
            <span id="renderErrorMsg">Preview failed to load.</span>
          </div>
          <div className="element-editor" id="elementEditor">
            <input type="text" className="element-editor-input" id="editorInput" placeholder="What to change…" />
            <button className="editor-action accent" id="editorSubmit" title="Apply">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 11V2M6.5 2L2.5 6M6.5 2L10.5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button className="editor-action" id="editorEditText" title="Edit text" style={{ display: 'none' }}>✏️</button>
            <button className="editor-action" id="editorReplaceImage" title="Replace image" style={{ display: 'none' }}>🖼️</button>
            <button className="editor-action danger" id="editorDelete" title="Remove element">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 3h10M4 3V2h4v1M3 3v7h6V3"/></svg>
            </button>
            <button className="editor-action" id="editorClose" title="Close">
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
            </button>
          </div>
        </div>

        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <img src="/static/img/logo.png" alt="Nebulux" className="sidebar-logo" />
              <span className="sidebar-brand-label">AI Studio</span>
            </div>
            <div className="sidebar-tab-group">
              <button className="sidebar-tab active" data-tab="chat">Chat</button>
              <button className="sidebar-tab" data-tab="history">History</button>
            </div>
            <button className="sidebar-close-btn" id="sidebarCloseBtn" title="Close panel">
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
            </button>
          </div>

          <div className="panel active" id="chatPanel">
            <div className="sidebar-body" id="sidebarBody">
              <div className="selection-banner" id="selectionBanner">
                <div className="selection-label">Targeting</div>
                <div className="selection-path">
                  <span className="selection-tag" id="selectionTag">div</span>
                  <span id="selectionInfo">.hero</span>
                </div>
              </div>
              <div className="messages-spacer"></div>
              <div className="messages" id="messages"></div>
            </div>
            <div className="sidebar-footer">
              <div className="editing-label" id="editingLabel">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/></svg>
                <span>Targeting: <strong id="editingTarget">element</strong></span>
              </div>
              <div className="chat-file-previews" id="chatFilePreviews"></div>
              <div id="pending-files-preview" className="pending-files-preview"></div>
              <div className="edit-mode-bar" id="editModeBar">
                <span className="mode-label">Mode:</span>
                <button className="mode-btn active" data-mode="" title="AI picks the right edit mode">Auto</button>
                <button className="mode-btn" data-mode="content" title="Text &amp; copy only — no structural changes">Content</button>
                <button className="mode-btn" data-mode="style" title="Colors, fonts, spacing only — no text changes">Style</button>
                <button className="mode-btn" data-mode="layout" title="Structure &amp; layout only — no text or styles">Layout</button>
              </div>
              <div className="chat-input-wrap">
                <button id="attachBtn" className="attach-btn" title="Attach files" aria-label="Attach files">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  <span className="attach-badge" id="attachBadge">0</span>
                </button>
                <input type="file" id="fileInput" multiple accept="image/*,.txt,.html,.css,.js,.json,.pdf,.md,.csv,.py" hidden />
                <textarea className="chat-input" id="chatInput" placeholder="Describe a change…" rows="1"></textarea>
                <button id="sendBtn" className="send-btn" title="Send" aria-label="Send message">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                    <path d="M6.5 11V2M6.5 2L2.5 6M6.5 2L10.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="panel" id="historyPanel">
            <div className="sidebar-body" id="historyBody">
              <div className="empty-state" id="historyEmpty">No versions yet. Edits will appear here.</div>
              <div id="historyList"></div>
            </div>
          </div>
        </aside>
      </div>

      {/* Publish Panel */}
      <div className="publish-panel" id="publishPanel">
        <div className="publish-panel-header">
          <span className="publish-panel-title">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2l9 7-9 7-9-7 9-7z"/><path d="M3 17l9 5 9-5"/></svg>
            Publish
          </span>
          <button className="publish-panel-close" id="publishPanelClose">
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
          </button>
        </div>

        <div className="publish-panel-body">
          <div className="publish-changes-banner" id="publishChangesBanner" style={{ display: 'none' }}>
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            You have unpublished changes.
            <button className="publish-changes-btn" id="republishBtn">Publish update</button>
          </div>

          <div id="publishedState" style={{ display: 'none' }}>
            <div className="publish-live-row">
              <span className="publish-live-dot"></span>
              <span className="publish-live-label">Live</span>
              <a className="publish-live-url" id="publishLiveUrl" href="#" target="_blank" rel="noopener"></a>
            </div>
            <div className="publish-actions-row">
              <button className="publish-copy-btn" id="publishCopyBtn">
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                Copy link
              </button>
              <button className="publish-unpublish-btn" id="unpublishBtn">Unpublish</button>
            </div>
          </div>

          <div id="unpublishedState">
            <p className="publish-hint">Choose a subdomain:</p>
            <div className="publish-subdomain-row">
              <div className="publish-subdomain-input-wrap">
                <input className="publish-subdomain-input" id="publishSubdomainInput" type="text"
                  placeholder="your-site-name" maxLength="50" autoComplete="off" spellCheck="false" />
                <span className="publish-subdomain-suffix">.nebulux.one</span>
              </div>
              <span className="publish-subdomain-status" id="subdomainStatus"></span>
            </div>

            <div className="publish-panel-divider" style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}></div>

            <p className="publish-hint" style={{ fontWeight: 600, marginBottom: '8px', fontSize: '12px' }}>Option A — Just publish</p>
            <button className="publish-go-btn" id="publishGoBtn" disabled>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2l9 7-9 7-9-7 9-7z"/><path d="M3 17l9 5 9-5"/></svg>
              Publish site
            </button>

            <div className="publish-panel-divider" style={{ margin: '16px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}></div>

            <p className="publish-hint" style={{ color: '#6366f1', fontWeight: 600, marginBottom: '4px', fontSize: '12px' }}>Option B — Add a Backend (optional)</p>
            <p className="publish-hint" style={{ fontSize: '11px', opacity: 0.6, marginTop: 0, marginBottom: '14px' }}>Connect Supabase to give your site a real database, user login, and API — free.</p>

            <div id="supabaseConnectSection" style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginBottom: '12px', lineHeight: 1.6 }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '8px' }}>How to connect</span>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#3ecf8e', fontWeight: 700, minWidth: '16px' }}>1</span>
                  <span>Create a free project at <a href="https://supabase.com" target="_blank" style={{ color: '#3ecf8e', textDecoration: 'none' }}>supabase.com</a></span>
                </span>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#3ecf8e', fontWeight: 700, minWidth: '16px' }}>2</span>
                  <span>Go to <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Settings → API Keys</strong> in your project</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#3ecf8e', fontWeight: 700, minWidth: '16px' }}>3</span>
                  <span>Copy your <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Project URL</strong>, <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Publishable key</strong> and <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Service Role key</strong></span>
                </span>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
                  <span style={{ color: '#3ecf8e', fontWeight: 700, minWidth: '16px' }}>4</span>
                  <span>Paste them below and click <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Publish &amp; Download</strong></span>
                </span>
              </div>
              <input
                id="supabaseUrlInput"
                type="text"
                placeholder="Project URL — https://xxxx.supabase.co"
                style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#fff', marginBottom: '6px', outline: 'none' }}
              />
              <input
                id="supabaseAnonKeyInput"
                type="password"
                placeholder="Publishable key — sb_publishable_..."
                style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#fff', marginBottom: '6px', outline: 'none' }}
              />
              <input
                id="supabaseServiceKeyInput"
                type="password"
                placeholder="Service Role key — sb_secret_... (for auto table creation)"
                style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#fff', marginBottom: '6px', outline: 'none' }}
              />
              <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginBottom: '6px', lineHeight: 1.4 }}>
                Service Role key is used server-side only to create your database tables automatically. Never exposed in your site's code.
              </p>
              <div id="supabaseConnectStatus" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '10px', minHeight: '16px' }}></div>
            </div>

            <button className="publish-go-btn" id="publishFullBtn" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', border: 'none', color: 'white' }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M12 2l-4 4M12 2l4 4"/></svg>
              Publish &amp; Download Bundle
            </button>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '8px', marginBottom: 0, lineHeight: 1.5, textAlign: 'center' }}>
              Publishes your site live + downloads a ZIP backup.<br />
              Supabase credentials are optional.
            </p>
          </div>
        </div>
      </div>
      <div className="publish-panel-overlay" id="publishPanelOverlay"></div>

      {/* Export Modal */}
      <div className="export-modal" id="exportModal">
        <div className="export-modal-content">
          <div className="export-header">
            <div className="export-breadcrumb">
              <span id="exportProjectTitle">Project</span>
              <span className="breadcrumb-arrow">›</span>
              <span className="export-file-count" id="exportFileInfo">1/1</span>
            </div>
            <button className="export-close-btn" id="exportCloseBtn">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>
            </button>
          </div>
          <div className="export-tabs">
            <button className="export-tab active" data-export-tab="html">HTML</button>
            <button className="export-tab" data-export-tab="css">CSS</button>
          </div>
          <div className="export-code-area" id="exportCodeArea">
            <pre className="export-code" id="exportCode"></pre>
          </div>
          <div className="export-actions">
            <div className="export-actions-left">
              <button className="export-btn" id="copyCodeBtn">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="8" height="9" rx="1"/>
                  <path d="M7 3V2a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-1"/>
                </svg>
                Copy
              </button>
              <button className="export-btn" id="openFigmaBtn">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4.667 13.333A2.667 2.667 0 007.333 10.667V8H4.667a2.667 2.667 0 000 5.333zM4.667 2.667h2.666V7.333H4.667a2.667 2.667 0 110-5.333zM11.333 8a2.667 2.667 0 100-5.333 2.667 2.667 0 000 5.333zM7.333 2.667h2.666a2.667 2.667 0 010 5.333H7.333V2.667zM11.333 13.333a2.667 2.667 0 100-5.333 2.667 2.667 0 000 5.333z"/>
                </svg>
                Figma
              </button>
            </div>
            <div className="export-actions-right">
              <button className="export-btn primary" id="downloadBtn">
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6.5 1v8m0 0L4 7m2.5 2L9 7"/>
                  <path d="M1 10v1.5A1.5 1.5 0 002.5 13h9a1.5 1.5 0 001.5-1.5V10"/>
                </svg>
                Download
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New Page Panel */}
      <div className="new-page-panel" id="newPagePanel">
        <div className="npp-header">
          <span className="npp-title">New Page</span>
          <button className="npp-close" id="newPageClose" title="Close">
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8"/></svg>
          </button>
        </div>
        <div className="npp-section">
          <label className="npp-label">Page name</label>
          <input className="npp-input" id="nppName" placeholder="about" spellCheck="false" maxLength="60" />
        </div>
        <div className="npp-section">
          <label className="npp-label">Page type</label>
          <div className="npp-chips" id="nppTypeChips"></div>
        </div>
        <div className="npp-section">
          <label className="npp-label">Style</label>
          <div className="npp-chips" id="nppStyleChips"></div>
        </div>
        <div className="npp-color-row">
          <div className="npp-colors" id="nppColors"></div>
          <button className="npp-color-inherit-btn" id="nppColorInheritBtn" type="button" title="Auto (inherit)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
        </div>
        <div className="npp-section" id="nppInheritSection">
          <label className="npp-label">Inherit design from</label>
          <div className="npp-inherit-list" id="nppInheritList"></div>
        </div>
        <div className="npp-section">
          <label className="npp-label">Notes <span className="npp-label-opt">(optional)</span></label>
          <textarea className="npp-textarea" id="nppNotes" placeholder="Any specific content, sections, or features…" rows="2"></textarea>
        </div>
        <button className="npp-create-btn" id="nppCreateBtn">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 1v10M1 6h10"/></svg>
          Generate Page
        </button>
      </div>

      {/* Delete Confirm Modal */}
      <div className="delete-confirm-overlay" id="deleteConfirmOverlay">
        <div className="dcm-content">
          <div className="dcm-icon">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </div>
          <div className="dcm-title">Delete page?</div>
          <div className="dcm-subtitle">This will permanently remove<br /><span className="dcm-page-name" id="dcmPageName">page.html</span></div>
          <div className="dcm-actions">
            <button className="dcm-btn" id="dcmCancel">Cancel</button>
            <button className="dcm-btn danger" id="dcmConfirm">Delete</button>
          </div>
        </div>
      </div>
    </>
  )
}

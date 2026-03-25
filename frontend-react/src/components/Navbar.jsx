import React from 'react'

export default function Navbar({ showNavLinks = true, showNavProfile = true }) {
  return (
    <nav>
      <a href="/" className="logo">
        <img src="/static/img/logo.png" className="logo-img" alt="Nebulux" />
        <span className="logo-text">Nebulux</span>
      </a>

      {showNavLinks && (
        <div className="nav-links">
          <a href="/#showcase">My Galaxy</a>
          <a href="/pricing/">Pricing</a>
        </div>
      )}

      {showNavProfile && (
        <div className="nav-profile profile-dropdown-anchor">
          <button className="profile-icon-btn" id="profileIconBtn" aria-label="Profile menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
          <div className="profile-dropdown" id="profileDropdown">
            <div id="dropdownAuthenticated" style={{ display: 'none' }}>
              <div className="dropdown-user-row">
                <div className="dropdown-avatar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                  </svg>
                </div>
                <div className="dropdown-user-info">
                  <div className="dropdown-user-name" id="dropdownUserName">—</div>
                  <div className="dropdown-user-email" id="dropdownUserEmail"></div>
                </div>
              </div>
              <div className="dropdown-plan-card" id="dropdownPlanCard">
                <div className="dropdown-plan-label">CURRENT PLAN</div>
                <div className="dropdown-plan-row">
                  <span className="dropdown-plan-name">Free</span>
                  <button className="dropdown-plan-upgrade" id="dropdownUpgradeBtn">Upgrade →</button>
                </div>
                <div className="dropdown-plan-tokens"></div>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-menu">
                <span className="dropdown-menu-item templates-disabled" aria-disabled="true" title="Coming Soon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                  Templates
                  <span className="dropdown-coming-soon">Soon</span>
                </span>
                <a href="/settings/" className="dropdown-menu-item" id="dropdownAccountBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  Settings
                </a>
              </div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-menu">
                <button className="dropdown-menu-item danger" id="dropdownSignoutBtn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Sign out
                </button>
              </div>
            </div>
            <div id="dropdownSigninPanel">
              <div className="dropdown-menu">
                <span className="dropdown-menu-item templates-disabled" aria-disabled="true" title="Coming Soon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
                    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  </svg>
                  Templates
                  <span className="dropdown-coming-soon">Soon</span>
                </span>
                <a href="/pricing/" className="dropdown-menu-item">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23"/>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  Pricing
                </a>
              </div>
              <div className="dropdown-divider"></div>
              <div style={{ padding: '4px 8px 8px' }}>
                <button className="dropdown-signin-btn" id="dropdownSigninBtn">Sign in</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

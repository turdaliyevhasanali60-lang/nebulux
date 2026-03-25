import React, { useEffect, useRef } from 'react'
import Layout from '../components/Layout.jsx'
import '../styles/settings.css'

export default function SettingsPage() {
  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    import('../scripts/settings-page.js').then(m => m.initSettings())
  }, [])

  return (
    <Layout
      title="Settings — NEBULUX"
      showFooter={false}
    >
      <div className="settings-page" id="settingsPage">

        {/* Sidebar */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h1 className="settings-title">Settings</h1>
          </div>
          <nav className="settings-nav">
            <button className="settings-nav-item active" data-tab="profile">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              Profile
            </button>
            <button className="settings-nav-item" data-tab="subscription">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Subscription
            </button>
            <button className="settings-nav-item" data-tab="billing">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
              Billing
            </button>
          </nav>

          <div className="settings-sidebar-footer">
            <button className="settings-signout-btn" id="settingsSignoutBtn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main className="settings-main">

          {/* Profile */}
          <section className="settings-panel active" id="panelProfile">
            <div className="settings-panel-header">
              <h2>Profile</h2>
              <p className="settings-panel-desc">Manage your account details</p>
            </div>

            <div className="settings-card">
              <div className="settings-avatar-row">
                <div className="settings-avatar">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div className="settings-avatar-info">
                  <span className="settings-avatar-name" id="settingsAvatarName">—</span>
                  <span className="settings-avatar-email" id="settingsAvatarEmail">—</span>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-field">
                <label htmlFor="settingsName">Display name</label>
                <input type="text" id="settingsName" placeholder="Your name" autoComplete="name" />
              </div>
              <div className="settings-field">
                <label htmlFor="settingsEmail">Email address</label>
                <input type="email" id="settingsEmail" placeholder="—" readOnly className="readonly" />
              </div>
              <div className="settings-field-actions">
                <button className="settings-btn primary" id="settingsSaveBtn">Save changes</button>
                <span className="settings-save-status" id="settingsSaveStatus"></span>
              </div>
            </div>

            <div className="settings-card" id="passwordCard">
              <div className="settings-card-label">Change password</div>
              <div id="passwordForm">
                <div className="settings-field">
                  <label htmlFor="currentPassword">Current password</label>
                  <input type="password" id="currentPassword" placeholder="••••••••" autoComplete="current-password" />
                </div>
                <div className="settings-field">
                  <label htmlFor="newPassword">New password</label>
                  <input type="password" id="newPassword" placeholder="••••••••" autoComplete="new-password" />
                </div>
                <div className="settings-field">
                  <label htmlFor="confirmPassword">Confirm new password</label>
                  <input type="password" id="confirmPassword" placeholder="••••••••" autoComplete="new-password" />
                </div>
                <div className="settings-field-actions">
                  <button className="settings-btn primary" id="changePasswordBtn">Update password</button>
                  <span className="settings-save-status" id="passwordStatus"></span>
                </div>
              </div>
            </div>

            <div className="settings-card danger-zone" id="deleteAccountCard">
              <div className="settings-card-label">Danger zone</div>
              <p className="settings-card-desc" style={{ marginBottom: '16px' }}>Permanently delete your account and all associated data. This cannot be undone.</p>
              <div id="deleteConfirmBox" style={{ display: 'none' }} className="billing-cancel-box">
                <p>Type <strong style={{ color: '#fff' }}>DELETE</strong> to confirm you want to permanently remove your account.</p>
                <div className="settings-field" style={{ marginBottom: '12px' }}>
                  <input type="text" id="deleteConfirmInput" placeholder="Type DELETE to confirm" />
                </div>
                <div className="billing-cancel-btns">
                  <button className="settings-btn secondary" id="deleteCancelBtn">Cancel</button>
                  <button className="settings-btn danger" id="deleteConfirmBtn" disabled>Delete my account</button>
                </div>
              </div>
              <button className="settings-btn danger" id="deleteAccountBtn">Delete account</button>
            </div>
          </section>

          {/* Subscription */}
          <section className="settings-panel" id="panelSubscription">
            <div className="settings-panel-header">
              <h2>Subscription</h2>
              <p className="settings-panel-desc">Your plan and available credits</p>
            </div>

            <div className="settings-card plan-overview-card">
              <div className="plan-overview-row">
                <div className="plan-overview-info">
                  <span className="plan-overview-label">Current plan</span>
                  <span className="plan-overview-name" id="subPlanName">Free</span>
                </div>
                <div className="plan-overview-info">
                  <span className="plan-overview-label">Credits remaining</span>
                  <span className="plan-overview-name" id="subCreditsDisplay">0 / 0</span>
                </div>
              </div>
              <div className="credits-meter">
                <div className="credits-meter-track">
                  <div className="credits-meter-fill" id="subCreditsMeter" style={{ width: '0%' }}></div>
                </div>
                <span className="credits-meter-note" id="subCreditsNote">Resets on the 1st of each month</span>
              </div>
            </div>

            <div className="settings-card plan-grid-wrap">
              <div className="settings-card-label">Plans</div>
              <div className="plan-grid" id="settingsPlanGrid"></div>
              <div id="settingsPacksWrap"></div>
            </div>
          </section>

          {/* Billing */}
          <section className="settings-panel" id="panelBilling">
            <div className="settings-panel-header">
              <h2>Billing</h2>
              <p className="settings-panel-desc">Payment method and transaction history</p>
            </div>

            <div id="billingContent">
              <div className="settings-loader">
                <div className="settings-spinner"></div>
                <span>Loading billing info…</span>
              </div>
            </div>
          </section>

        </main>
      </div>

      {/* Mobile tab bar */}
      <div className="settings-mobile-tabs">
        <button className="settings-mobile-tab active" data-tab="profile">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Profile</span>
        </button>
        <button className="settings-mobile-tab" data-tab="subscription">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span>Plan</span>
        </button>
        <button className="settings-mobile-tab" data-tab="billing">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          <span>Billing</span>
        </button>
      </div>
    </Layout>
  )
}

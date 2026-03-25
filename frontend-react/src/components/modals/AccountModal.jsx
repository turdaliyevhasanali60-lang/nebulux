import React from 'react'

export default function AccountModal() {
  return (
    <div className="account-modal-overlay" id="accountModalOverlay">
      <div className="account-modal">
        <div className="modal-sidebar">
          <div className="modal-sidebar-title">Settings</div>
          <button className="modal-tab-btn active" data-tab="account">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Profile
          </button>
          <button className="modal-tab-btn" data-tab="subscription">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
            Subscription
          </button>
        </div>
        <div className="modal-content-area">
          <button className="modal-close-btn" id="accountModalClose" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div className="modal-tab-panel active" id="panelAccount">
            <h2 className="modal-section-title">Profile</h2>
            <div className="modal-avatar-row">
              <div className="modal-avatar-placeholder">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            </div>
            <div className="account-field">
              <label htmlFor="accountName">Name <span className="field-required">*</span></label>
              <input type="text" id="accountName" placeholder="Your name" />
            </div>
            <div className="account-field">
              <label htmlFor="accountEmail">Email</label>
              <input type="email" id="accountEmail" placeholder="—" readOnly className="readonly-field" />
            </div>
            <button className="account-save-btn" id="accountSaveBtn">Save</button>
          </div>
          <div className="modal-tab-panel" id="panelSubscription">
            <h2 className="modal-section-title">Subscription</h2>
            <div className="sub-meta-row">
              <div className="sub-meta-item">
                <span className="sub-meta-label">Your plan</span>
                <span className="sub-meta-value" id="subCurrentPlan">Free</span>
              </div>
              <div className="sub-meta-item">
                <span className="sub-meta-label">Credits</span>
                <span className="sub-meta-value" id="subCreditsValue">0 / 0</span>
              </div>
            </div>
            <div className="billing-toggle" id="billingToggle">
              <button className="billing-pill active" data-billing="monthly">Monthly</button>
              <button className="billing-pill" data-billing="yearly">Yearly <span className="save-tag">Save 20%</span></button>
            </div>
            <div className="plan-cards-grid" id="planCardsGrid"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

import React from 'react'

export default function ConfirmDeleteModal() {
  return (
    <div className="confirm-modal" id="confirmDeleteModal" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <div className="confirm-box">
        <div className="confirm-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </div>
        <h3 className="confirm-title" id="confirmTitle">Delete this project?</h3>
        <p className="confirm-sub">
          <em className="confirm-name" id="confirmProjectName"></em> will be permanently removed from your galaxy. This cannot be undone.
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn" id="confirmCancelBtn">Keep it</button>
          <button className="confirm-btn danger" id="confirmDeleteBtn">Delete forever</button>
        </div>
      </div>
    </div>
  )
}

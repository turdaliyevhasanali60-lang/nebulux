import React from 'react'

export default function ErrorModal() {
  return (
    <div className="loading-modal" id="errorModal">
      <div className="error-content">
        <div className="error-icon">⚠️</div>
        <h3 className="error-title">Oops! Something went wrong</h3>
        <p className="error-message" id="errorMessage">We couldn't generate your website. Please try again.</p>
        <button className="error-btn" id="errorCloseBtn">Try Again</button>
      </div>
    </div>
  )
}

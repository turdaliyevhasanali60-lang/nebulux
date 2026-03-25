import React from 'react'

export default function SignoutModal() {
  return (
    <div className="signout-confirm-overlay" id="signoutConfirm">
      <div className="signout-confirm-box">
        <h3 className="signout-confirm-title">Sign out?</h3>
        <div className="signout-confirm-actions">
          <button id="signoutCancelBtn">Cancel</button>
          <button className="signout-go" id="signoutGoBtn">Sign out</button>
        </div>
      </div>
    </div>
  )
}

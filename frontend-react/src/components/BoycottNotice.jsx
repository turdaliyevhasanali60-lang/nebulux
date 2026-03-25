import React, { useEffect, useState } from 'react'

export default function BoycottNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('boycottDismissed')) {
      const timer = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(timer)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    localStorage.setItem('boycottDismissed', '1')
  }

  if (!visible) return null

  return (
    <div
      id="boycottNotice"
      style={{
        display: 'block',
        position: 'fixed',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: '90%',
        maxWidth: '560px',
        background: '#0f0f1a',
        border: '1px solid rgba(255,100,100,0.25)',
        borderRadius: '14px',
        padding: '18px 24px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        animation: 'slideDown 0.4s ease',
      }}
    >
      <style>{`@keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ flexShrink: 0, width: '36px', height: '36px', background: 'rgba(255,100,100,0.1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 700, fontSize: '0.85rem', color: '#ff6b6b', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '6px' }}>We boycott OpenAI</div>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            Your prompts and ideas are <strong style={{ color: 'rgba(255,255,255,0.85)' }}>never sold, never used to train models.</strong> We chose Claude. We chose you.
          </p>
        </div>
        <button onClick={dismiss} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: '18px', lineHeight: 1, padding: 0 }}>✕</button>
      </div>
    </div>
  )
}

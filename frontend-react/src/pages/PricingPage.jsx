import React, { useEffect, useRef } from 'react'
import Layout from '../components/Layout.jsx'
import '../styles/style.css'
import '../styles/pricing.css'

export default function PricingPage() {
  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true

    // Load Sora font (pricing page specific)
    if (!document.getElementById('sora-font')) {
      const link = document.createElement('link')
      link.id   = 'sora-font'
      link.rel  = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'
      document.head.appendChild(link)
    }

    // Load Toastify CSS + JS then init
    if (!document.getElementById('toastify-css')) {
      const link = document.createElement('link')
      link.id   = 'toastify-css'
      link.rel  = 'stylesheet'
      link.href = 'https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css'
      document.head.appendChild(link)
    }
    if (!window.Toastify) {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/toastify-js'
      s.onload = () => {
        import('../scripts/pricing-page.js').then(m => m.initPricing())
      }
      document.head.appendChild(s)
    } else {
      import('../scripts/pricing-page.js').then(m => m.initPricing())
    }
  }, [])

  return (
    <Layout
      title="Pricing — Nebulux"
      showNavLinks={false}
      showNavProfile={false}
      showFooter={false}
    >
      {/* Extra CSS for hero override */}
      <style>{`
        .hero {
          min-height: unset !important;
          display: block !important;
          max-width: unset !important;
          margin: 0 !important;
          padding: 80px 48px 60px !important;
          text-align: center !important;
        }
      `}</style>

      <section className="hero">
        <h1>Choose Your Plan</h1>
        <p className="hero-sub-pricing">Simple, transparent pricing. No hidden fees.</p>
      </section>

      {/* ===== SUBSCRIPTION PLANS ===== */}
      <section className="pricing-section" id="plans">
        <div className="pricing-grid">

          {/* Free */}
          <div className="plan-card">
            <div className="plan-icon">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="12" r="4" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="16" x2="24" y2="28" stroke="white" strokeWidth="1.5"/>
                <circle cx="12" cy="34" r="3.5" stroke="white" strokeWidth="1.5"/>
                <circle cx="36" cy="34" r="3.5" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="28" x2="12" y2="31" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="28" x2="36" y2="31" stroke="white" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="plan-name">Free</div>
            <div className="plan-tagline">Perfect for trying out Nebulux</div>
            <div className="price-block">
              <span className="price">$0</span>
              <span className="price-note">/ month</span>
            </div>
            <button className="plan-btn" disabled>Current Plan</button>
            <div className="divider"></div>
            <div className="features-label">What's included:</div>
            <ul className="features">
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>200 credits / month</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Build up to 3 websites</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>1 project</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Community support</li>
            </ul>
          </div>

          {/* Standard — ACTIVE / PURCHASABLE */}
          <div className="plan-card featured" style={{ position: 'relative' }}>
            <div className="popular-badge">Available Now</div>
            <div className="plan-icon">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="10" r="4" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="14" x2="24" y2="22" stroke="white" strokeWidth="1.5"/>
                <circle cx="14" cy="26" r="3.5" stroke="white" strokeWidth="1.5"/>
                <circle cx="34" cy="26" r="3.5" stroke="white" strokeWidth="1.5"/>
                <circle cx="14" cy="38" r="3" stroke="white" strokeWidth="1.5"/>
                <circle cx="34" cy="38" r="3" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="22" x2="14" y2="23" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="22" x2="34" y2="23" stroke="white" strokeWidth="1.5"/>
                <line x1="14" y1="29.5" x2="14" y2="35" stroke="white" strokeWidth="1.5"/>
                <line x1="34" y1="29.5" x2="34" y2="35" stroke="white" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="plan-name">Standard</div>
            <div className="plan-tagline">For designers and solo creators</div>
            <div className="price-block">
              <span className="price">$14.99</span>
              <span className="price-note">/ month</span>
            </div>
            <button className="plan-btn plan-btn-active" id="buyStandardBtn" data-product="standard_monthly">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Get Standard
            </button>
            <div className="divider"></div>
            <div className="features-label">What's included:</div>
            <ul className="features">
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>~30 websites / month</li>
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Unlimited pages per website</li>
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>5 projects</li>
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Unlimited export to code</li>
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Email support</li>
              <li><svg className="check-icon featured-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Purchase additional credits</li>
            </ul>
          </div>

          {/* Pro — COMING SOON */}
          <div className="plan-card">
            <div className="plan-icon">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="8" r="4" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="12" x2="24" y2="20" stroke="white" strokeWidth="1.5"/>
                <circle cx="10" cy="24" r="3.5" stroke="white" strokeWidth="1.5"/>
                <circle cx="24" cy="24" r="3.5" stroke="white" strokeWidth="1.5"/>
                <circle cx="38" cy="24" r="3.5" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="20" x2="10" y2="21" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="20" x2="38" y2="21" stroke="white" strokeWidth="1.5"/>
                <circle cx="10" cy="36" r="3" stroke="white" strokeWidth="1.5"/>
                <circle cx="24" cy="36" r="3" stroke="white" strokeWidth="1.5"/>
                <circle cx="38" cy="36" r="3" stroke="white" strokeWidth="1.5"/>
                <line x1="10" y1="27.5" x2="10" y2="33" stroke="white" strokeWidth="1.5"/>
                <line x1="24" y1="27.5" x2="24" y2="33" stroke="white" strokeWidth="1.5"/>
                <line x1="38" y1="27.5" x2="38" y2="33" stroke="white" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="plan-name">Pro</div>
            <div className="plan-tagline" style={{ color: 'var(--accent)' }}>For power users and teams</div>
            <div className="price-block">
              <span className="price">$29</span>
              <span className="price-note">/ month</span>
            </div>
            <button className="plan-btn plan-btn-active" id="buyProBtn" data-product="pro_monthly">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              Get Pro
            </button>
            <div className="divider"></div>
            <div className="features-label">Everything in Standard, plus:</div>
            <ul className="features">
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>5,00200 credits / month</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>~75 websites / month</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Unlimited projects</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Unlimited pages per website</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Unlimited export to code</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Purchase additional credits</li>
              <li><svg className="check-icon" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Priority support</li>
            </ul>
          </div>

        </div>
      </section>

      {/* ===== CREDIT PACKS ===== */}
      <section className="credits-section" id="creditPacks">
        <h2 className="credits-title">Need more credits?</h2>
        <p className="credits-sub">Top up your credits with a one-time purchase. Requires an active Standard plan.</p>

        <div id="creditPacksContainer">
          <div id="creditGridWrapper" className="credit-grid-locked" style={{ position: 'relative' }}>
            <div className="credit-grid-overlay" id="creditGridOverlay" style={{ display: 'none' }}>
              <div className="credit-grid-overlay-label" id="creditOverlayBtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9bd4ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Upgrade to Standard to purchase credits
              </div>
            </div>
            <div className="credit-grid-inner">
              <div className="credit-grid">

                {/* Starter Pack */}
                <div className="credit-card">
                  <div className="credit-top">
                    <div className="credit-name">Starter Pack</div>
                  </div>
                  <div className="credit-amount">400 Token Units</div>
                  <div className="credit-desc">~3 extra websites or 16 targeted edits. Great for finishing a project or quick iterations.</div>
                  <div className="credit-price-row">
                    <div className="credit-price">$4.99</div>
                    <div className="sep">·</div>
                    <div className="credit-per">$0.0125 / TU</div>
                  </div>
                  <button className="buy-btn" data-product="starter_pack">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                    Buy Starter
                  </button>
                </div>

                {/* Builder Pack */}
                <div className="credit-card credit-card-featured">
                  <div className="credit-top">
                    <div className="credit-name">Builder Pack</div>
                    <div className="best">Popular</div>
                  </div>
                  <div className="credit-amount">850 Token Units</div>
                  <div className="credit-desc">~6 extra websites with full edits. Perfect for client work or building out a full project.</div>
                  <div className="credit-price-row">
                    <div className="credit-price">$8.99</div>
                    <div className="sep">·</div>
                    <div className="credit-per">$0.0106 / TU</div>
                  </div>
                  <button className="buy-btn buy-btn-featured" data-product="builder_pack">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                    Buy Builder
                  </button>
                </div>

                {/* Agency Pack */}
                <div className="credit-card">
                  <div className="credit-top">
                    <div className="credit-name">Agency Pack</div>
                    <div className="best best-value">Best Value</div>
                  </div>
                  <div className="credit-amount">1,600 Token Units</div>
                  <div className="credit-desc">~11 extra websites. For agencies shipping client sites fast — best rate we offer.</div>
                  <div className="credit-price-row">
                    <div className="credit-price">$14.99</div>
                    <div className="sep">·</div>
                    <div className="credit-per">$0.0094 / TU</div>
                  </div>
                  <button className="buy-btn" data-product="agency_pack">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                    Buy Agency
                  </button>
                </div>

              </div>
            </div>
          </div>
        </div>

        <div className="credits-guarantee">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Secure payments via Lemon Squeezy. Credits are added instantly after purchase.
        </div>
      </section>
    </Layout>
  )
}

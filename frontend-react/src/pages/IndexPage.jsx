import React, { useEffect, useRef } from 'react'
import Layout from '../components/Layout.jsx'
import '../styles/style.css'

export default function IndexPage() {
  const initedRef = useRef(false)

  useEffect(() => {
    // app-page.js adds 'page-loaded' on the window 'load' event, but that
    // already fired before React mounts. Set it directly so animations play.
    if (document.readyState === 'complete') {
      document.body.classList.add('page-loaded')
    }

    if (initedRef.current) return
    initedRef.current = true
    import('../scripts/app-page.js').then(m => m.initApp())
  }, [])

  const bodyBefore = (
    <>
      <div className="giant-planet" id="giantPlanet">
        <div className="planet-glow"></div>
        <img src="/static/img/planet-2-Photoroom.avif" alt="Giant Planet" />
      </div>
      <div className="second-planet" id="secondPlanet">
        <div className="planet-glow"></div>
        <img src="/static/img/planet-1-Photoroom.avif" alt="Saturn Planet" />
      </div>
      <div className="nebula-layer nebula-1"></div>
      <div className="nebula-layer nebula-2"></div>
      <div className="nebula-layer nebula-3"></div>
    </>
  )

  return (
    <Layout
      title="NEBULUX — Light from the nebula"
      bodyBefore={bodyBefore}
    >
      <section className="hero">
        <h1>
          <span className="word word-1">Create</span>{' '}
          <span className="word word-2">What</span>{' '}
          <span className="word word-3">Does</span>{' '}
          <span className="word word-4">Not</span>{' '}
          <span className="word word-5">Yet</span>{' '}
          <span className="word word-6">Exist.</span>
        </h1>
        <p className="hero-sub">Describe it. Launch it in seconds.</p>
        <div className="prompt-container">
          <div className="prompt-box">
            <div className="inline-attachments" id="referencePreview"></div>
            <textarea
              className="prompt-input"
              id="promptInput"
              placeholder="Describe your idea..."
              rows="1"
            ></textarea>
            <div className="prompt-required" id="promptRequired" hidden aria-live="polite">Required</div>
            <div className="prompt-divider" aria-hidden="true"></div>
            <div className="prompt-bottom">
              <input
                type="file"
                id="referenceFileInput"
                accept="image/*,.html,.css,.js,.ts,.jsx,.tsx,.py,.json,.md,.txt,.yaml,.yml,.sh,.sql,.php,.rb,.go,.rs,.vue,.env"
                style={{ display: 'none' }}
                aria-hidden="true"
                multiple
              />
              <button className="reference-btn" id="referenceBtn" aria-label="Attach file">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                <span id="referenceBtnLabel">Attach</span>
              </button>
              <button className="prompt-btn" aria-label="Generate">
                <span>Generate</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="prompt-chips">
            <button className="prompt-chip" data-prompt="travel">Travel Planner App</button>
            <button className="prompt-chip" data-prompt="learning">Learning App</button>
            <button className="prompt-chip" data-prompt="finance">Finance App</button>
            <button className="prompt-chip" data-prompt="shopping">Shopping App</button>
          </div>
        </div>
      </section>

      <section className="showcase" id="showcase">
        <div className="showcase-label">Your Galaxy</div>
        <br />
        <div className="galaxy-empty" id="galaxyEmpty">
          <p className="galaxy-empty-text">Your galaxy is empty — for now.</p>
        </div>
        <div className="showcase-grid galaxy-grid" id="galaxyGrid" style={{ display: 'none' }}></div>
      </section>
    </Layout>
  )
}

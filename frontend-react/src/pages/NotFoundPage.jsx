import React from 'react'
import Layout from '../components/Layout.jsx'

export default function NotFoundPage() {
  return (
    <Layout
      title="404 — Nebulux"
      showNavLinks={false}
      showNavProfile={false}
      showFooter={false}
    >
      <style>{`
        .page-404 {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          position: relative;
          background: url("/static/img/404page.png") center center / cover no-repeat;
        }
        .page-404::before {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(5, 5, 15, 0.6);
        }
        .content-404 {
          position: relative;
          z-index: 1;
          padding: 40px 24px;
        }
        .content-404 h1 {
          font-family: 'Syne', sans-serif;
          font-size: clamp(5rem, 15vw, 10rem);
          font-weight: 800;
          color: #F7941D;
          line-height: 1;
          margin-bottom: 16px;
        }
        .content-404 p {
          color: rgba(255,255,255,0.6);
          font-size: 1rem;
          margin-bottom: 32px;
        }
        .content-404 a {
          display: inline-block;
          padding: 12px 32px;
          background: #F7941D;
          color: #0a0a0f;
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          border-radius: 8px;
          text-decoration: none;
          transition: opacity 0.2s;
        }
        .content-404 a:hover { opacity: 0.85; }
      `}</style>
      <main className="page-404">
        <div className="content-404">
          <p>This page doesn't exist.</p>
          <a href="/">Back to Nebulux</a>
        </div>
      </main>
    </Layout>
  )
}

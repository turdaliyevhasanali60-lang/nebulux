import React from 'react'
import Layout from '../components/Layout.jsx'
import '../styles/legal-styles-additions.css'

export default function ContactPage() {
  return (
    <Layout title="Contact — Nebulux">
      <main className="legal-page">
        <div className="legal-container">

          <div className="legal-header">
            <div className="legal-badge">Contact</div>
            <h1>Get in <span className="legal-accent">Touch</span></h1>
            <p className="legal-lead">We're a small, fast-moving team. Whether you have a question, found a bug, or want to share feedback — we'd love to hear from you.</p>
          </div>

          <div className="legal-body">

            <section>
              <h2><span className="section-num">↗</span> Reach Us Directly</h2>
              <p>Choose the channel that works best for you. We typically respond within 24 hours on business days.</p>

              <div className="contact-links">
                <a href="https://t.me/HasanaliDev" target="_blank" rel="noopener" className="contact-item contact-item--featured">
                  <div className="contact-item-left">
                    <svg className="contact-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                    <div>
                      <span className="contact-label">Telegram</span>
                      <span className="contact-description">Best for support &amp; general questions</span>
                    </div>
                  </div>
                  <span className="contact-value">@HasanaliDev</span>
                </a>

                <a href="https://x.com/NebuluxSpace" target="_blank" rel="noopener" className="contact-item contact-item--featured">
                  <div className="contact-item-left">
                    <svg className="contact-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
                    </svg>
                    <div>
                      <span className="contact-label">X (Twitter)</span>
                      <span className="contact-description">Updates, announcements &amp; quick chats</span>
                    </div>
                  </div>
                  <span className="contact-value">@NebuluxSpace</span>
                </a>
              </div>
            </section>

            <section style={{ marginTop: '56px' }}>
              <h2><span className="section-num">?</span> What to Include</h2>
              <p>To help us respond faster, please include the following when reaching out about a technical issue:</p>
              <ul className="legal-list">
                <li>A brief description of what you were trying to do and what happened instead</li>
                <li>The email address associated with your Nebulux account</li>
                <li>A screenshot or screen recording if the issue is visual</li>
                <li>The approximate date and time the issue occurred</li>
              </ul>
              <p>For billing questions, include your transaction ID (found in the receipt email from Lemon Squeezy).</p>
            </section>

            <section style={{ marginTop: '56px' }}>
              <h2><span className="section-num">→</span> Common Topics</h2>

              <div className="faq-list">
                <div className="faq-item">
                  <p className="faq-q">I ran out of credits. How do I get more?</p>
                  <p className="faq-a">You can top up your credits or upgrade your subscription from the billing section in your account dashboard.</p>
                </div>
                <div className="faq-item">
                  <p className="faq-q">I was charged but didn't receive credits.</p>
                  <p className="faq-a">Reach out via Telegram with your transaction ID and we'll resolve it promptly — usually within a few hours.</p>
                </div>
                <div className="faq-item">
                  <p className="faq-q">Can I request a refund?</p>
                  <p className="faq-a">Credits and subscriptions are generally non-refundable. If there was a technical error or billing mistake, contact us and we'll review your case within 48 hours.</p>
                </div>
                <div className="faq-item">
                  <p className="faq-q">I have a feature suggestion.</p>
                  <p className="faq-a">We love hearing ideas from users. Drop us a message on Telegram or X — well-described suggestions often make it into our roadmap.</p>
                </div>
                <div className="faq-item">
                  <p className="faq-q">How do I delete my account?</p>
                  <p className="faq-a">Send us a message via Telegram from the email associated with your account and we'll process the deletion within 30 days, as per our Privacy Policy.</p>
                </div>
              </div>
            </section>

          </div>
        </div>
      </main>
    </Layout>
  )
}

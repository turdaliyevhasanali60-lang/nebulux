import React from 'react'
import Layout from '../components/Layout.jsx'
import '../styles/legal-styles-additions.css'

export default function PrivacyPage() {
  return (
    <Layout title="Privacy Policy — Nebulux">
      <main className="legal-page">
        <div className="legal-container">

          <div className="legal-header">
            <div className="legal-badge">Privacy Policy</div>
            <h1>Your Privacy, <span className="legal-accent">Our Priority</span></h1>
            <p className="legal-lead">We built Nebulux with transparency in mind. This policy explains exactly what data we collect, why we collect it, and how we protect it.</p>
            <p className="legal-date">Last updated: March 2026 &nbsp;·&nbsp; Effective: March 2026</p>
          </div>

          <nav className="legal-toc">
            <p className="toc-label">On this page</p>
            <ol className="toc-list">
              <li><a href="#section-1">Information We Collect</a></li>
              <li><a href="#section-2">How We Use Your Information</a></li>
              <li><a href="#section-3">AI Generation &amp; Prompts</a></li>
              <li><a href="#section-4">Payments &amp; Billing</a></li>
              <li><a href="#section-5">Cookies &amp; Tracking</a></li>
              <li><a href="#section-6">Data Sharing &amp; Third Parties</a></li>
              <li><a href="#section-7">Data Security</a></li>
              <li><a href="#section-8">Data Retention</a></li>
              <li><a href="#section-9">Your Rights</a></li>
              <li><a href="#section-10">Children's Privacy</a></li>
              <li><a href="#section-11">International Transfers</a></li>
              <li><a href="#section-12">Changes to This Policy</a></li>
              <li><a href="#section-13">Contact Us</a></li>
            </ol>
          </nav>

          <div className="legal-body">

            <section id="section-1">
              <h2><span className="section-num">1.</span> Information We Collect</h2>
              <p>We collect information you provide directly and information generated as you use Nebulux.</p>

              <h3>Account Information</h3>
              <p>When you sign in with Google, we receive your name, email address, and Google profile picture. We use this to identify your account and personalize your experience. We do not have access to your Google password or other Google account data.</p>

              <h3>Usage Data</h3>
              <p>We automatically record information about your interactions with the service, including: websites you generate, prompts you submit, pages you visit within Nebulux, feature usage patterns, and timestamps of your activity. This data helps us improve the product and diagnose issues.</p>

              <h3>Subscription &amp; Credit Data</h3>
              <p>We store your current subscription plan, credit balance, and transaction history (but not raw payment card data — see Section 4). This is necessary to enforce plan limits and display your account status.</p>

              <h3>Technical Data</h3>
              <p>We receive standard technical information your browser sends, including your IP address, browser type and version, operating system, referring URLs, and device type. This data is used for security monitoring and aggregate analytics.</p>

              <h3>Communications</h3>
              <p>If you contact us via Telegram or X, we retain a record of that communication in order to respond and follow up. We do not store these outside the platforms on which they occur.</p>
            </section>

            <section id="section-2">
              <h2><span className="section-num">2.</span> How We Use Your Information</h2>
              <p>We use the data we collect for the following purposes only:</p>
              <ul className="legal-list">
                <li><strong>Service delivery</strong> — to generate websites, manage your account, process credits, and provide customer support.</li>
                <li><strong>Product improvement</strong> — to understand how features are used, identify pain points, and prioritize development. Analytics are reviewed in aggregate form where possible.</li>
                <li><strong>Security &amp; fraud prevention</strong> — to detect abuse, unauthorized access, and violations of our Terms of Service.</li>
                <li><strong>Legal compliance</strong> — to meet obligations under applicable law, such as retaining records for tax or regulatory purposes.</li>
                <li><strong>Communications</strong> — to send you important service updates (e.g., account changes, credit top-ups, policy updates). We do not send marketing emails without your explicit opt-in.</li>
              </ul>
              <p>We do not build advertising profiles, sell your data, or use your content to train AI models without explicit consent.</p>
            </section>

            <section id="section-3">
              <h2><span className="section-num">3.</span> AI Generation &amp; Prompts</h2>
              <p>Nebulux uses Anthropic's Claude AI to power website generation. When you submit a prompt, it is transmitted to Anthropic's API for processing. Your prompt data is subject to <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener">Anthropic's Privacy Policy</a> in addition to this one.</p>
              <p>We store the prompts you submit alongside the generated output so you can review your generation history and we can reproduce or debug results. You can delete your generated websites at any time from your dashboard, which also removes the associated prompt from our storage.</p>
              <p>We do not use your prompts or generated websites to train or fine-tune any AI model, and we do not share them with third parties except as required by law or as described in Section 6.</p>
            </section>

            <section id="section-4">
              <h2><span className="section-num">4.</span> Payments &amp; Billing</h2>
              <p>All payment processing is handled by <strong>Lemon Squeezy</strong>. We never receive or store your raw credit card number, CVV, or full bank details. Lemon Squeezy is PCI-DSS compliant, and their privacy practices are governed by their own <a href="https://www.lemonsqueezy.com/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
              <p>We do receive and store: the last four digits of your card (for display purposes), your billing country, purchase amounts, transaction IDs, and subscription status. This information is necessary to manage your account and provide receipts.</p>
              <p>If you request a refund, we may need to share your transaction ID with Lemon Squeezy to process it.</p>
            </section>

            <section id="section-5">
              <h2><span className="section-num">5.</span> Cookies &amp; Tracking</h2>
              <p>We use a minimal set of cookies that are necessary for the service to function:</p>
              <ul className="legal-list">
                <li><strong>Session cookies</strong> — to keep you logged in across page loads. These expire when you close your browser or log out.</li>
                <li><strong>Preference cookies</strong> — to remember lightweight UI preferences (e.g., last-used prompt settings).</li>
                <li><strong>Security cookies</strong> — to protect against CSRF attacks and session hijacking.</li>
              </ul>
              <p>We do not use third-party advertising cookies, social media tracking pixels, or behavioral retargeting technologies. If we introduce analytics cookies in the future, we will update this policy and provide a consent mechanism where required by law.</p>
            </section>

            <section id="section-6">
              <h2><span className="section-num">6.</span> Data Sharing &amp; Third Parties</h2>
              <p>We share your data only in the following limited circumstances:</p>
              <ul className="legal-list">
                <li><strong>Anthropic</strong> — prompts you submit are processed by Anthropic's Claude API. See Section 3.</li>
                <li><strong>Lemon Squeezy</strong> — payment and subscription data. See Section 4.</li>
                <li><strong>Infrastructure providers</strong> — we use cloud hosting providers to store your account data and generated content. These providers are contractually prohibited from accessing or using your data for their own purposes.</li>
                <li><strong>Legal requirements</strong> — we may disclose information if required by a valid court order, law enforcement request, or to protect the rights and safety of our users or the public.</li>
                <li><strong>Business transfers</strong> — in the event of a merger, acquisition, or sale of assets, your data may be transferred as part of that transaction. We will notify you before your data is transferred and becomes subject to a different privacy policy.</li>
              </ul>
              <p>We do not sell, rent, or trade your personal information to any third party for commercial purposes.</p>
            </section>

            <section id="section-7">
              <h2><span className="section-num">7.</span> Data Security</h2>
              <p>We implement industry-standard technical and organizational measures to protect your data, including:</p>
              <ul className="legal-list">
                <li>Encryption in transit (TLS 1.2+) for all data exchanged between your browser and our servers</li>
                <li>Encryption at rest for stored account data and generated websites</li>
                <li>Access controls limiting data access to personnel who need it to perform their job</li>
                <li>Regular review of our security practices and dependency updates</li>
              </ul>
              <p>Despite these measures, no system is perfectly secure. If you believe your account has been compromised, please contact us immediately via Telegram at <a href="https://t.me/HasanaliDev" target="_blank" rel="noopener">@HasanaliDev</a>.</p>
            </section>

            <section id="section-8">
              <h2><span className="section-num">8.</span> Data Retention</h2>
              <p>We retain your account data for as long as your account is active. Specifically:</p>
              <ul className="legal-list">
                <li><strong>Account information</strong> — retained until you delete your account.</li>
                <li><strong>Generated websites and prompts</strong> — retained until you delete them or delete your account.</li>
                <li><strong>Transaction records</strong> — retained for up to 7 years as required by applicable tax and financial laws, even after account deletion.</li>
                <li><strong>Technical logs</strong> — retained for up to 90 days for security and debugging, then automatically deleted.</li>
              </ul>
              <p>To delete your account and associated data, contact us via Telegram. We will process your request within 30 days.</p>
            </section>

            <section id="section-9">
              <h2><span className="section-num">9.</span> Your Rights</h2>
              <p>Depending on where you are located, you may have the following rights regarding your personal data:</p>
              <ul className="legal-list">
                <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
                <li><strong>Correction</strong> — ask us to correct inaccurate or incomplete data.</li>
                <li><strong>Deletion</strong> — request that we delete your personal data (subject to our legal obligations to retain certain records).</li>
                <li><strong>Portability</strong> — receive your data in a structured, machine-readable format.</li>
                <li><strong>Restriction</strong> — ask us to restrict processing of your data in certain circumstances.</li>
                <li><strong>Objection</strong> — object to processing based on legitimate interests.</li>
              </ul>
              <p>To exercise any of these rights, contact us via <a href="https://t.me/HasanaliDev" target="_blank" rel="noopener">Telegram</a>. We will respond within 30 days. We may need to verify your identity before fulfilling the request.</p>
            </section>

            <section id="section-10">
              <h2><span className="section-num">10.</span> Children's Privacy</h2>
              <p>Nebulux is not directed at children under the age of 13, and we do not knowingly collect personal data from children. If you believe a child has provided us with personal information without parental consent, please contact us and we will promptly delete it.</p>
            </section>

            <section id="section-11">
              <h2><span className="section-num">11.</span> International Data Transfers</h2>
              <p>Nebulux is operated globally, which means your data may be processed in countries outside your own, including the United States. When we transfer data internationally, we rely on appropriate safeguards such as Standard Contractual Clauses (where applicable) to ensure your data remains protected in accordance with this policy.</p>
            </section>

            <section id="section-12">
              <h2><span className="section-num">12.</span> Changes to This Policy</h2>
              <p>We may update this Privacy Policy from time to time. We will notify you of material changes by updating the "Last updated" date at the top of this page and, where feasible, by sending a notice to your registered email address. Your continued use of Nebulux after changes are posted constitutes your acceptance of the updated policy.</p>
            </section>

            <section id="section-13">
              <h2><span className="section-num">13.</span> Contact Us</h2>
              <p>For any privacy-related questions, data requests, or concerns, please reach out to us:</p>
              <div className="contact-links" style={{ marginTop: '20px' }}>
                <a href="https://t.me/HasanaliDev" target="_blank" rel="noopener" className="contact-item">
                  <span className="contact-label">Telegram</span>
                  <span className="contact-value">@HasanaliDev</span>
                </a>
                <a href="https://x.com/NebuluxSpace" target="_blank" rel="noopener" className="contact-item">
                  <span className="contact-label">X (Twitter)</span>
                  <span className="contact-value">@NebuluxSpace</span>
                </a>
              </div>
            </section>

          </div>
        </div>
      </main>
    </Layout>
  )
}

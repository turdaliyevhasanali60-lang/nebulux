import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

import IndexPage    from './pages/IndexPage.jsx'
import BuilderPage  from './pages/BuilderPage.jsx'
import PricingPage  from './pages/PricingPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ContactPage  from './pages/ContactPage.jsx'
import PrivacyPage  from './pages/PrivacyPage.jsx'
import TermsPage    from './pages/TermsPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<IndexPage />} />
        <Route path="/builder/"  element={<BuilderPage />} />
        <Route path="/pricing/"  element={<PricingPage />} />
        <Route path="/settings/" element={<SettingsPage />} />
        <Route path="/contact/"  element={<ContactPage />} />
        <Route path="/privacy/"  element={<PrivacyPage />} />
        <Route path="/terms/"    element={<TermsPage />} />
        <Route path="*"          element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

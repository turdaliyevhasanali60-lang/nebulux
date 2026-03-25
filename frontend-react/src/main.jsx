// auth.js and api.js run as IIFEs setting window.Auth and window.API
// They must be imported before React renders so they're available globally
import './scripts/auth.js'
import './scripts/api.js'

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <App />
)

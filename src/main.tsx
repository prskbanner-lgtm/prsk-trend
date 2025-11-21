import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css' // optional: if you want to add global styles

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

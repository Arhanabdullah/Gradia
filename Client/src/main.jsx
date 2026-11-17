import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext'
import { initTheme } from './lib/theme'

initTheme()

const root = createRoot(document.getElementById('root'))

// Hide initial loader once React hydrates
const hideInitialLoader = () => {
  const loader = document.getElementById('init-loader')
  if (loader) {
    loader.setAttribute('data-hidden', '')
    // Remove from DOM after transition
    setTimeout(() => loader.remove(), 300)
  }
}

root.render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

// Hydration complete - hide initial loader
if (document.readyState === 'complete') {
  hideInitialLoader()
} else {
  window.addEventListener('load', hideInitialLoader)
}

// Also hide on hydration (React 18)
document.addEventListener('react-hydrated', hideInitialLoader, { once: true })
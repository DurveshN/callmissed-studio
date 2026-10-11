import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ensurePageFonts } from './features/fonts/load-fonts'
import './app/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// Bundled fonts load from local files in milliseconds; text layout must not be measured before them.
void ensurePageFonts()
  .catch((error: unknown) => console.error('Failed to load bundled fonts', error))
  .finally(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  )

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from './App'
import '../utils/attachLifecycleDebug'
import { captureQaFlagFromUrl } from '@/utils/mediaDiag'

// Antes de cualquier redireccion: ?qa=1 se perdia al aterrizar en otra ruta.
captureQaFlagFromUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

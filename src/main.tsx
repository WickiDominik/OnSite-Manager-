import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);

// Offline support for the browser/PWA variant (the Android app ships its files locally anyway)
if ('serviceWorker' in navigator && import.meta.env.PROD && !('Capacitor' in window && (window as any).Capacitor?.isNativePlatform?.())) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

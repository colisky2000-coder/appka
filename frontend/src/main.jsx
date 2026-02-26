import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../../app.jsx';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
if (window.Telegram?.WebApp?.ready) {
  window.Telegram.WebApp.ready();
}

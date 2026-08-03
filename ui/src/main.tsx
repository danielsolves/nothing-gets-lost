// ui/src/main.tsx
// Mounts the page. Nothing else belongs here: there is no router and no store,
// because there is exactly one page and one stream of state (spec 2).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('the page is missing its #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

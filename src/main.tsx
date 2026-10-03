import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import './math.css';
import { registerResearchTools } from './webmcp';
registerResearchTools();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

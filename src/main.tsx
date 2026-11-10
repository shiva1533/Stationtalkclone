import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Startup from './Startup';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Startup />
  </StrictMode>,
);

import { createRoot } from 'react-dom/client';
import { AdminRoot } from './AdminRoot.tsx';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <AdminRoot />,
);

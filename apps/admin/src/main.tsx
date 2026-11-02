import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { EditSessionsProvider } from './EditSessions.tsx';
import { SelectorsProvider } from './Selectors.tsx';
import './style.css';
createRoot(document.getElementById('root')!).render(
  <EditSessionsProvider>
    <SelectorsProvider>
      <App />
    </SelectorsProvider>
  </EditSessionsProvider>,
);

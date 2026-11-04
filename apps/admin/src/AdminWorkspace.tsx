import { App, type AppProps } from './App.tsx';
import { EditSessionsProvider } from './EditSessions.tsx';
import { SelectorsProvider } from './Selectors.tsx';
export default function AdminWorkspace(props:AppProps){return <EditSessionsProvider><SelectorsProvider><App {...props}/></SelectorsProvider></EditSessionsProvider>;}

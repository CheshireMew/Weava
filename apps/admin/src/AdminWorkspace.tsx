import { App, type AppProps } from './App.tsx';
import { EditSessionsProvider,useEditSessions } from './EditSessions.tsx';
import { SelectorsProvider } from './Selectors.tsx';
import {ErrorBoundary} from './ErrorBoundary.tsx';
function WorkspaceContents(props:AppProps){const editors=useEditSessions();return <ErrorBoundary onReload={async()=>{await editors.preserve();window.location.reload();}}><SelectorsProvider><App {...props}/></SelectorsProvider></ErrorBoundary>;}
export default function AdminWorkspace(props:AppProps){return <EditSessionsProvider><WorkspaceContents {...props}/></EditSessionsProvider>;}

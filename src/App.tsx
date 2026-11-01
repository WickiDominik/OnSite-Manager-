import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useToast } from './components/Toast';
import { completeLoginFromUrl } from './lib/bimcollab';
import { authEnabled, supabase, type Session } from './lib/platformAuth';
import { AuthPage, NewPasswordPage } from './pages/AuthPage';
import { IssueDetailPage } from './pages/IssueDetailPage';
import { IssuesPage } from './pages/IssuesPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ViewerPage } from './pages/ViewerPage';

export function App() {
  const toast = useToast();
  const [session, setSession] = useState<Session | null | undefined>(authEnabled ? undefined : null);
  const [recovery, setRecovery] = useState(false);

  // finish a BimCollab OAuth redirect (…/?code=…&state=…)
  useEffect(() => {
    completeLoginFromUrl()
      .then((ok) => ok && toast('BimCollab-Konto verbunden', 'success'))
      .catch((e) => toast((e as Error).message, 'error'));
  }, [toast]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (authEnabled) {
    if (session === undefined) return <div className="empty">Laden …</div>;
    if (recovery) return <NewPasswordPage onDone={() => setRecovery(false)} />;
    if (!session) return <AuthPage />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<IssuesPage />} />
        <Route path="/projects/:projectId/issues/:issueId" element={<IssueDetailPage />} />
        <Route path="/projects/:projectId/viewer" element={<ViewerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

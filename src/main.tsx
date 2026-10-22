import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { track } from './game/analytics';
import { initAnalytics } from './game/analytics';
import { captureChallenge } from './game/challenge';
import './styles.css';

captureChallenge();   // a ?c= challenge link: kept for the Daily, then taken out of the address
initAnalytics();
/** The last line of defence: a crash anywhere in the page shows this instead of a blank screen. Saved games are untouched. */
class AppBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e?.message ?? 'error' }; }
  componentDidCatch(e: Error) { track('app_error', { where: 'app', message: String(e?.message ?? e).slice(0, 120) }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ font: '16px/1.5 system-ui, sans-serif', padding: '48px 24px', maxWidth: 560, margin: 'auto' }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong on this screen</h1>
        <p>Your saved games and settings are safe in this browser. Reload to carry on; if it keeps happening, use Help &amp; refunds and mention what you were doing.</p>
        <button onClick={() => location.reload()} style={{ font: 'inherit', padding: '10px 18px' }}>Reload</button>
      </main>
    );
  }
}
createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>);

/** If a saved career ever can't be shown (an update changed something it relies on), offer a way out, not a blank page. */
import { Component, type ReactNode } from 'react';
import { saveCareer } from '../../career/save';
import { track } from '../../game/analytics';

export class CareerBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message || 'Something went wrong.' }; }
  componentDidCatch(e: Error) { track('app_error', { where: 'career', message: e.message.slice(0, 120) }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="cr-page">
        <section className="cr-card">
          <div className="eyebrow">Career mode · Beta</div>
          <h2>This career couldn't load</h2>
          <p className="muted">Career mode is in beta, and an update may have changed something your save relies on. Try reloading first. If it still won't open, start a new career.</p>
          <div className="row">
            <button className="btn primary" onClick={() => location.reload()}>Reload</button>
            <button className="btn" onClick={() => { if (confirm('Delete this career and start a new one?')) { saveCareer(null); location.reload(); } }}>Start a new career</button>
          </div>
        </section>
      </div>
    );
  }
}

import { Component, type ReactNode } from 'react';

/**
 * One misbehaving tab must never black out the whole console.
 *
 * Every tab body is wrapped in this boundary, keyed by the tab id, so a crash in
 * one screen shows a readable panel (with the exact error and the stack) and the
 * nav keeps working. Without it React unmounts the tree and the page goes black —
 * which tells nobody anything.
 */
type Props = { tab: string; children: ReactNode };
type State = { error: Error | null; info: string };

export class TabBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: any) {
    // keep it in the console as well, so a screenshot of devtools is enough
    console.error('tab crash in ' + this.props.tab, error, info?.componentStack || '');
    this.setState({ info: String(info?.componentStack || '').slice(0, 1200) });
    try { (window as any).__lastTabError = { tab: this.props.tab, message: error.message, stack: String(error.stack || '') }; } catch { /* ignore */ }
  }

  componentDidUpdate(prev: Props) {
    if (prev.tab !== this.props.tab && this.state.error) this.setState({ error: null, info: '' });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/[0.07] p-4">
        <div className="text-[12px] font-black text-red-200">
          This screen ({this.props.tab}) crashed — the rest of the console still works.
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-red-200/80">
          Send this text to the developer and it can be fixed exactly:
        </p>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-500/30 bg-zinc-950 p-2 font-mono text-[10px] text-red-200">
          {error.message}
        </pre>
        {info ? (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-[9.5px] text-zinc-400">
            {info}
          </pre>
        ) : null}
        <button
          onClick={() => this.setState({ error: null, info: '' })}
          className="mt-2 rounded-lg border border-red-500/50 px-2.5 py-1 text-[10px] font-bold text-red-200 hover:bg-red-500/20"
        >
          Try again
        </button>
      </div>
    );
  }
}

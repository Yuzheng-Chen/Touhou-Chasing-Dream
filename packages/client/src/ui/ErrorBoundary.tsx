import { Component, type ErrorInfo, type ReactNode } from 'react';

/** A rendering bug must never leave a white screen: show a way back instead. The server keeps the game running meanwhile. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crashed:', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash__card panel">
          <h2>界面出了点问题</h2>
          <p>不用担心：你的座位和对局还在服务器上。点击下面的按钮刷新页面即可回到牌桌。</p>
          <pre>{String(this.state.error.message).slice(0, 200)}</pre>
          <button className="btn btn--primary" onClick={() => location.reload()}>刷新页面</button>
        </div>
      </div>
    );
  }
}

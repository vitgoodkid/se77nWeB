import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[se77n] runtime error:', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          background: '#0d0a08',
          color: '#f5ede0',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ maxWidth: 540, textAlign: 'left' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.22em', color: '#E04545', marginBottom: 14 }}>
            ◇ RUNTIME · CRASH
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Something tripped.</h1>
          <p style={{ marginTop: 12, color: 'rgba(245,237,224,0.6)', lineHeight: 1.6, fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <button
            onClick={() => location.reload()}
            style={{
              marginTop: 20,
              padding: '10px 18px',
              background: '#E04545',
              color: '#0d0a08',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.16em',
              cursor: 'pointer',
            }}
          >
            ↻ RELOAD
          </button>
        </div>
      </div>
    );
  }
}

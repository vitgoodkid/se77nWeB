import { Component } from 'react';

// Crash screen in the arcade look ("game over" dialog). Uses only theme
// variables + arcade.css classes, so it works in light and dark.
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
          color: 'var(--text)',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <div style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
          <span
            className="sk"
            style={{
              position: 'absolute', left: 18, top: -14, zIndex: 1,
              padding: '5px 10px', fontSize: 11,
              color: '#fffaf0', background: 'var(--strip)',
            }}
          >
            RUNTIME · CRASH
          </span>
          <div className="px" role="alert" style={{ padding: '36px 30px 30px', background: 'var(--paper)' }}>
            <h1 className="pf" style={{ margin: 0, fontSize: 44, lineHeight: 1 }}>
              GAME <span style={{ color: '#e04545', textShadow: '3px 3px 0 var(--ink)' }}>OVER</span>
            </h1>
            <p style={{ margin: '14px 0 0', fontSize: 15, fontWeight: 700 }}>Something tripped.</p>
            <p
              style={{
                margin: '14px 0 0', padding: '12px 14px',
                background: 'var(--field)', color: 'var(--muted)',
                fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere',
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </p>
            <div style={{ marginTop: 24, padding: '0 10px 10px 4px' }}>
              <button
                onClick={() => location.reload()}
                className="pbtn sk"
                style={{
                  height: 48, padding: '0 20px',
                  background: '#e04545', color: '#1b1410',
                  fontSize: 14,
                }}
              >
                CONTINUE? ↻ RELOAD
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

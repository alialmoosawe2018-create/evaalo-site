import React from 'react';
import { reportError } from '../observability/errorReporter';

/**
 * Catches render-time crashes.
 *
 * Without a boundary React unmounts the whole tree on any thrown render error, so
 * the user got a blank white page and we got no trace at all. This keeps the app
 * shell alive, shows a recoverable message, and reports the crash.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        reportError({
            message: `React render crash: ${error?.message || error}`,
            stack: `${error?.stack || ''}\n--- componentStack ---${info?.componentStack || ''}`,
            severity: 'error',
        });
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return (
            <div
                role="alert"
                style={{
                    maxWidth: 560,
                    margin: '18vh auto',
                    padding: '32px 28px',
                    textAlign: 'center',
                    fontFamily: 'inherit',
                }}
            >
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 10px' }}>
                    {this.props.title || 'Something went wrong'}
                </h1>
                <p style={{ color: '#475569', lineHeight: 1.7, margin: '0 0 22px' }}>
                    {this.props.body ||
                        'The page hit an unexpected error. Reloading usually fixes it.'}
                </p>
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{
                        padding: '12px 26px',
                        fontWeight: 700,
                        color: '#fff',
                        background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                        border: 'none',
                        borderRadius: 12,
                        cursor: 'pointer',
                    }}
                >
                    {this.props.reloadLabel || 'Reload'}
                </button>
            </div>
        );
    }
}

export default ErrorBoundary;

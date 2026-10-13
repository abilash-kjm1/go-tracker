'use client';

/**
 * The last resort: a failure in the root layout itself, where nothing of the
 * app — not the shell, not the theme script, not the stylesheet — is available.
 * It therefore carries its own <html> and <body> and its own inline styles,
 * and uses only colours that read on either a light or a dark backdrop.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#0b0f17',
          color: '#e8edf5',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '26rem' }}>
          <p style={{ fontSize: '28px', margin: 0 }} aria-hidden>
            ⚠
          </p>
          <h1 style={{ fontSize: '20px', fontWeight: 600, margin: '12px 0 6px' }}>
            GO Tracker failed to start
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#9aa7b8', margin: 0 }}>
            Something went wrong before the app could load. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '20px',
              minHeight: '44px',
              padding: '0 20px',
              borderRadius: '14px',
              border: 0,
              background: '#06b06f',
              color: '#04120b',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p style={{ fontSize: '11px', color: '#6b7a8d', marginTop: '16px' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}

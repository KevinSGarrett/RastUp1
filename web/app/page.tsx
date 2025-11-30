// web/app/page.tsx
"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { useViewer } from "./providers";

export default function HomePage() {
  const { viewer, loading, error } = useViewer();

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <h1>RastUp Dev Sandbox</h1>

          <p style={{ marginTop: "0.5rem" }}>
            Signed in as{" "}
            <strong>{viewer?.email ?? viewer?.username ?? user?.username}</strong>
          </p>

          {loading && (
            <p style={{ marginTop: "1rem" }}>Loading viewer…</p>
          )}

          {error && (
            <pre
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "#7f1d1d",
                color: "#fee2e2",
                borderRadius: "0.5rem",
                maxWidth: 640,
                overflow: "auto",
              }}
            >
{error}
            </pre>
          )}

          {viewer && (
            <pre
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "#111827",
                color: "#e5e7eb",
                borderRadius: "0.5rem",
                maxWidth: 640,
                overflow: "auto",
              }}
            >
{JSON.stringify(viewer, null, 2)}
            </pre>
          )}

          <button
            onClick={signOut}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1rem",
              borderRadius: "9999px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </main>
      )}
    </Authenticator>
  );
}

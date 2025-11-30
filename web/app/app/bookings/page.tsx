// web/app/app/bookings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import { configureAmplify } from "../../../lib/amplifyClient";

// Make sure Amplify is configured once on the client
configureAmplify();

type Viewer = {
  id: string;
  email: string | null;
  username?: string | null;
  groups: string[];
};

type Booking = {
  id: string;
  customerId: string;
  title: string;
  startTimeIso: string;
  endTimeIso: string;
  status: string;
  notes?: string | null;
};

const client = generateClient();

export default function BookingsPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingViewer, setLoadingViewer] = useState(true);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load viewer (identity + groups)
  useEffect(() => {
    const run = async () => {
      setLoadingViewer(true);
      setError(null);
      try {
        const { data, errors } = await client.queries.viewer();

        if (errors && errors.length > 0) {
          console.error(errors);
          setError(errors.map((e: any) => e.message ?? String(e)).join("\n"));
          return;
        }

        setViewer(data as Viewer);
      } catch (err: any) {
        console.error(err);
        setError(err?.message ?? String(err));
      } finally {
        setLoadingViewer(false);
      }
    };

    run();
  }, []);

  // Once we have a viewer, load their bookings
  useEffect(() => {
    if (!viewer?.id) return;

    const run = async () => {
      setLoadingBookings(true);
      setError(null);
      try {
        const { data, errors } = await client.models.Booking.list();

        if (errors && errors.length > 0) {
          console.error(errors);
          setError(errors.map((e: any) => e.message ?? String(e)).join("\n"));
          return;
        }

        const all = (data ?? []) as Booking[];
        // Client-side filter: only show this user's bookings
        setBookings(all.filter((b) => b.customerId === viewer.id));
      } catch (err: any) {
        console.error(err);
        setError(err?.message ?? String(err));
      } finally {
        setLoadingBookings(false);
      }
    };

    run();
  }, [viewer?.id]);

  const handleCreateDemoBooking = async () => {
    if (!viewer?.id) return;
    setCreating(true);
    setError(null);

    try {
      const now = new Date();
      const startIso = now.toISOString();
      const endIso = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // +1 hour
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());

      const { data, errors } = await client.models.Booking.create({
        id,
        customerId: viewer.id,
        title: "Demo booking",
        startTimeIso: startIso,
        endTimeIso: endIso,
        status: "PENDING",
        notes: "Created from /app/bookings",
      });

      if (errors && errors.length > 0) {
        console.error(errors);
        setError(errors.map((e: any) => e.message ?? String(e)).join("\n"));
        return;
      }

      if (data) {
        setBookings((prev) => [...prev, data as Booking]);
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <h1>My Bookings</h1>

          <p style={{ marginTop: "0.5rem" }}>
            Amplify user: <strong>{user?.username}</strong>
          </p>

          {loadingViewer && <p style={{ marginTop: "1rem" }}>Loading identity…</p>}

          {viewer && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.9rem", opacity: 0.8 }}>
              Viewer id: <code>{viewer.id}</code>
            </p>
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

          <section style={{ marginTop: "2rem", maxWidth: 720 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <h2 style={{ margin: 0 }}>Bookings for you</h2>
              <button
                onClick={handleCreateDemoBooking}
                disabled={creating || !viewer}
                style={{
                  padding: "0.4rem 1rem",
                  borderRadius: "9999px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {creating ? "Creating…" : "Create demo booking"}
              </button>
            </div>

            {loadingBookings && <p style={{ marginTop: "1rem" }}>Loading bookings…</p>}

            {!loadingBookings && bookings.length === 0 && (
              <p style={{ marginTop: "1rem" }}>No bookings yet. Try creating one.</p>
            )}

            {bookings.length > 0 && (
              <ul style={{ marginTop: "1rem", padding: 0, listStyle: "none", maxWidth: 720 }}>
                {bookings.map((b) => (
                  <li
                    key={b.id}
                    style={{
                      marginBottom: "0.75rem",
                      padding: "0.75rem 1rem",
                      borderRadius: 8,
                      background: "#111827",
                      color: "#e5e7eb",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{b.title}</div>
                    <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: "0.25rem" }}>
                      {b.startTimeIso} → {b.endTimeIso}
                    </div>
                    <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                      Status: <strong>{b.status}</strong>
                    </div>
                    {b.notes && (
                      <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                        Notes: {b.notes}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            onClick={signOut}
            style={{
              marginTop: "2rem",
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

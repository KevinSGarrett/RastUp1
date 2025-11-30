// web/app/app/me/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import { configureAmplify } from "../../../lib/amplifyClient";

// Make sure Amplify is configured once on the client
configureAmplify();

// Typed Amplify Data client
const client = generateClient<Schema>();

type Viewer = Schema["viewer"]["returnType"];
type ProfileModel = Schema["Profile"]["type"];

type ProfileForm = {
  displayName: string;
  city: string;
  country: string;
  bio: string;
};

export default function MePage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [profile, setProfile] = useState<ProfileModel | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    displayName: "",
    city: "",
    country: "",
    bio: "",
  });
  const [loadingViewer, setLoadingViewer] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load viewer (identity + groups)
  useEffect(() => {
    const run = async () => {
      setLoadingViewer(true);
      setError(null);
      try {
        const { data, errors } = await client.queries.viewer();
        if (errors && errors.length) {
          console.error(errors);
          setError(
            errors.map((e: any) => e.message ?? String(e)).join("\n"),
          );
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

  // Once we have the viewer, load or create their profile
  useEffect(() => {
    if (!viewer?.id) return;

    const run = async () => {
      setLoadingProfile(true);
      setError(null);
      try {
        const { data, errors } = await client.models.Profile.get({
          id: viewer.id,
        });

        if (errors && errors.length) {
          console.error(errors);
          setError(
            errors.map((e: any) => e.message ?? String(e)).join("\n"),
          );
          return;
        }

        const profileData = (data ?? null) as ProfileModel | null;

        if (profileData) {
          setProfile(profileData);
          setForm({
            displayName: profileData.displayName ?? "",
            city: profileData.city ?? "",
            country: profileData.country ?? "",
            bio: profileData.bio ?? "",
          });
        } else {
          // No profile yet – start with sensible defaults
          setProfile(null);
          setForm((prev) => ({
            ...prev,
            displayName: viewer.username ?? "",
          }));
        }
      } catch (err: any) {
        console.error(err);
        setError(err?.message ?? String(err));
      } finally {
        setLoadingProfile(false);
      }
    };

    run();
  }, [viewer?.id, viewer?.username]);

  const handleChange = (field: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!viewer?.id) return;
    setSaving(true);
    setError(null);

    try {
      const base = {
        id: viewer.id,
        email: viewer.email ?? null,
        displayName: form.displayName || viewer.username || viewer.id,
        city: form.city || null,
        country: form.country || null,
        bio: form.bio || null,
      };

      const op = profile
        ? client.models.Profile.update(base)
        : client.models.Profile.create(base);

      const { data, errors } = await op;

      if (errors && errors.length) {
        console.error(errors);
        setError(
          errors.map((e: any) => e.message ?? String(e)).join("\n"),
        );
        return;
      }

      setProfile((data ?? null) as ProfileModel | null);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <h1>My Identity (GraphQL)</h1>

          <p style={{ marginTop: "0.5rem" }}>
            Amplify user: <strong>{user?.username}</strong>
          </p>

          {/* Identity block */}
          {loadingViewer && (
            <p style={{ marginTop: "1rem" }}>Loading identity…</p>
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

          {/* Errors */}
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

          {/* Profile editor */}
          <section style={{ marginTop: "2rem", maxWidth: 640 }}>
            <h2>My Profile</h2>
            {loadingProfile ? (
              <p style={{ marginTop: "0.5rem" }}>Loading profile…</p>
            ) : (
              <>
                <div
                  style={{
                    marginTop: "1rem",
                    display: "grid",
                    gap: "0.75rem",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span>Display name</span>
                    <input
                      type="text"
                      value={form.displayName}
                      onChange={(e) =>
                        handleChange("displayName", e.target.value)
                      }
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderRadius: 6,
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span>City</span>
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) =>
                        handleChange("city", e.target.value)
                      }
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderRadius: 6,
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span>Country</span>
                    <input
                      type="text"
                      value={form.country}
                      onChange={(e) =>
                        handleChange("country", e.target.value)
                      }
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderRadius: 6,
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span>Bio</span>
                    <textarea
                      value={form.bio}
                      onChange={(e) =>
                        handleChange("bio", e.target.value)
                      }
                      rows={4}
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderRadius: 6,
                      }}
                    />
                  </label>
                </div>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    marginTop: "1rem",
                    padding: "0.5rem 1.25rem",
                    borderRadius: "9999px",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {saving
                    ? "Saving…"
                    : profile
                    ? "Save changes"
                    : "Create profile"}
                </button>
              </>
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

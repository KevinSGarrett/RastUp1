// web/app/providers.tsx
"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";

import { configureAmplify } from "../lib/amplifyClient";
import type { Schema } from "../../amplify/data/resource";

// Configure Amplify once on the client
configureAmplify();

// Strong-ish type for the viewer data coming from your Amplify `viewer` query
type Viewer = {
  id: string;
  email: string | null;
  username: string | null;
  groups: string[];
  isBuyer: boolean | null;
  isSeller: boolean | null;
  isStudioOwner: boolean | null;
  isAdmin: boolean | null;
  isTrust: boolean | null;
  isSupport: boolean | null;
  isFinance: boolean | null;
};

type ViewerHookResult = {
  viewer: Viewer | null;
  loading: boolean;
  error: string | null;
};

// Amplify Data client bound to your `Schema` from amplify/data/resource.ts
const client = generateClient<Schema>();

// Light wrapper so layout.tsx can wrap the whole app
export function AppProviders({ children }: { children: ReactNode }) {
  // If we ever add React Context for viewer/app-wide state, it can live here.
  return <>{children}</>;
}

// Hook used by app/page.tsx (and anything else) to read `viewer`
export function useViewer(): ViewerHookResult {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const { data, errors } = await client.queries.viewer({});

        if (cancelled) return;

        if (errors && errors.length > 0) {
          setError(
            errors
              .map((e: any) => e?.message ?? String(e))
              .join("\n")
          );
        } else {
          setViewer(data as Viewer);
        }
      } catch (err: any) {
        if (!cancelled) return;
        setError(err?.message ?? String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  return { viewer, loading, error };
}

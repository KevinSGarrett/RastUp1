// web/lib/amplifyClient.ts
"use client";

import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

let configured = false;

export function configureAmplify() {
  // Only configure once, on the client
  if (configured) return;
  if (typeof window === "undefined") return;

  Amplify.configure(outputs);
  configured = true;
}

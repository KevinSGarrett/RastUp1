// amplify/functions/viewer/handler.ts

type Viewer = {
  id: string;
  email: string | null;
  groups: string[];
  username?: string | null;
  emailVerified?: boolean;
  signInProvider?: string | null;
  issuer?: string | null;
};

export const handler = async (event: any): Promise<Viewer> => {
  const identity = event?.identity ?? {};
  const claims = identity?.claims ?? {};

  // Core subject identifier (Cognito sub / username)
  const sub =
    identity?.sub ??
    identity?.userId ??
    claims.sub ??
    claims["cognito:username"] ??
    "anonymous";

  // Primary email, if present on the token
  const email =
    claims.email ??
    claims["custom:email"] ??
    null;

  // Username from identity / claims
  const username =
    identity?.username ??
    claims["cognito:username"] ??
    claims.username ??
    null;

  // email_verified often comes as a boolean but can be a string
  const emailVerifiedRaw =
    claims["email_verified"] ??
    claims["custom:email_verified"];

  let emailVerified: boolean | undefined;
  if (typeof emailVerifiedRaw === "boolean") {
    emailVerified = emailVerifiedRaw;
  } else if (typeof emailVerifiedRaw === "string") {
    emailVerified = emailVerifiedRaw.toLowerCase() === "true";
  }

  // Groups – always return an array
  const groupsRaw =
    claims["cognito:groups"] ??
    identity?.groups ??
    [];

  const groups = Array.isArray(groupsRaw)
    ? groupsRaw.map((g) => String(g))
    : [];

  // Best-effort provider + issuer detection
  const signInProvider =
    claims["cognito:identity_provider"] ??
    claims["cognito:authentication_provider"] ??
    null;

  const issuer =
    identity?.issuer ??
    claims.iss ??
    null;

  return {
    id: String(sub),
    email: email ? String(email) : null,
    groups,
    username: username ? String(username) : null,
    emailVerified,
    signInProvider: signInProvider ? String(signInProvider) : null,
    issuer: issuer ? String(issuer) : null,
  };
};

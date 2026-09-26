// Firebase web config for the dashboard — dependency-free.
//
// No Firebase JS SDK is bundled. The seven VITE_FIREBASE_* values come from
// the gitignored `apps/dashboard/.env.local` (see `.env.example`). They are
// baked in at build time by Vite; the email/password form on the login page
// signs in through the Firebase Auth REST API (Identity Toolkit), then the
// returned ID token is exchanged for a local JWT via the backend's
// POST /api/auth/firebase.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
}

function env(name: string): string {
  const v = (import.meta.env as Record<string, unknown>)[name];
  return typeof v === "string" ? v : "";
}

/** Full config from build-time env. Returns null when nothing is configured. */
export function getFirebaseConfig(): FirebaseWebConfig | null {
  const config: FirebaseWebConfig = {
    apiKey: env("VITE_FIREBASE_API_KEY"),
    authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: env("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: env("VITE_FIREBASE_APP_ID"),
    measurementId: env("VITE_FIREBASE_MEASUREMENT_ID"),
  };
  if (Object.values(config).every((v) => v === "")) return null;
  return config;
}

/**
 * True when enough config is present to offer the email/password REST
 * sign-in form. `measurementId` is optional (Analytics only).
 */
export function isFirebaseConfigured(config: FirebaseWebConfig | null = getFirebaseConfig()): boolean {
  return (
    config !== null &&
    config.apiKey !== "" &&
    config.projectId !== ""
  );
}

export interface FirebaseSignInResult {
  idToken: string;
  email: string;
  localId: string;
}

/** Map Identity Toolkit error codes to user-friendly messages. */
export function friendlyFirebaseError(code: string): string {
  switch (code) {
    case "EMAIL_NOT_FOUND":
      return "No Firebase account found for that email.";
    case "INVALID_PASSWORD":
    case "INVALID_LOGIN_CREDENTIALS":
      return "Incorrect email or password.";
    case "USER_DISABLED":
      return "This Firebase account has been disabled.";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "Too many attempts — please try again later.";
    case "INVALID_API_KEY":
    case "API_KEY_NOT_VALID":
      return "Firebase configuration error (invalid API key). Check VITE_FIREBASE_API_KEY.";
    default:
      return `Firebase sign-in failed (${code}).`;
  }
}

interface RestSuccess {
  idToken: string;
  email: string;
  localId: string;
}

interface RestFailure {
  error?: { message?: string };
}

/**
 * Sign in with email/password via the Firebase Auth REST API
 * (https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword),
 * then return the Firebase ID token for exchange at POST /api/auth/firebase.
 *
 * `config` is injectable so tests can pass an explicit config; `fetchImpl`
 * defaults to the global fetch.
 */
export async function signInWithFirebaseRest(
  email: string,
  password: string,
  config: FirebaseWebConfig | null = getFirebaseConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<FirebaseSignInResult> {
  if (!config || config.apiKey === "") {
    throw new Error("Firebase is not configured (missing VITE_FIREBASE_API_KEY).");
  }
  const url =
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  let data: RestSuccess | RestFailure | null = null;
  try {
    data = (await res.json()) as RestSuccess | RestFailure;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !data || typeof (data as RestSuccess).idToken !== "string") {
    const raw = (data as RestFailure | null)?.error?.message ?? "";
    // REST errors look like "INVALID_PASSWORD" or "INVALID_PASSWORD : ..." —
    // take the first colon-delimited token as the code.
    const code = raw.split(":")[0].trim() || `HTTP_${res.status}`;
    throw new Error(friendlyFirebaseError(code));
  }
  const ok = data as RestSuccess;
  return { idToken: ok.idToken, email: ok.email, localId: ok.localId };
}

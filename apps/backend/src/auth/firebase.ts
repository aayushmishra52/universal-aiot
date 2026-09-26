/**
 * Optional Firebase authentication, layered on top of the default local
 * JWT/SQLite auth. When FIREBASE_PROJECT_ID is set, firebase-admin is loaded
 * lazily (dynamic import only on this path) and Firebase ID tokens can be
 * exchanged for local JWTs via POST /api/auth/firebase.
 *
 * Local auth stays the DEFAULT: with no Firebase env set, nothing here is
 * ever loaded and no new dependency is required.
 *
 * Never log raw credential material (service-account JSON, ID tokens).
 */

/** Minimal ambient typing for firebase-admin lives in ./firebase-admin.d.ts. */

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  name?: string;
}

/** Firebase auth is enabled iff a project id is configured. */
export function isFirebaseEnabled(): boolean {
  return !!process.env.FIREBASE_PROJECT_ID;
}

let appPromise: Promise<unknown> | null = null;

/** Load firebase-admin, with a clear error when the optional dep is missing. */
async function loadAdmin(): Promise<typeof import("firebase-admin")> {
  try {
    return await import("firebase-admin");
  } catch {
    throw new Error(
      "firebase-admin is not installed; run `npm install firebase-admin` to enable Firebase auth",
    );
  }
}

/** Lazily import firebase-admin and initialize it once. Never throws raw credentials. */
function getApp(): Promise<unknown> {
  if (!appPromise) {
    appPromise = (async () => {
      const admin = await loadAdmin();
      const projectId = process.env.FIREBASE_PROJECT_ID;
      if (!projectId) {
        throw new Error("Firebase auth is not enabled (FIREBASE_PROJECT_ID not set)");
      }
      let credential: unknown;
      const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (saJson && saJson.trim().length > 0) {
        let parsed: object;
        try {
          parsed = JSON.parse(saJson);
        } catch {
          // Do NOT include the raw JSON in the error.
          throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
        }
        credential = admin.credential.cert(parsed);
      } else {
        // Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS,
        // gcloud CLI auth, or GCE/GKE metadata server).
        credential = admin.credential.applicationDefault();
      }
      return admin.initializeApp({ credential, projectId });
    })();
    // Allow a later retry if initialization failed (e.g. transient ADC error).
    appPromise.catch(() => {
      appPromise = null;
    });
  }
  return appPromise;
}

/**
 * Verify a Firebase ID token against the configured project.
 * Returns the Firebase uid plus profile claims. Throws on invalid tokens;
 * callers must not log the token or credential material.
 */
export async function verifyFirebaseToken(
  idToken: string,
): Promise<VerifiedFirebaseUser> {
  if (!isFirebaseEnabled()) {
    throw new Error("Firebase auth is not enabled");
  }
  const admin = await loadAdmin();
  const app = await getApp();
  const decoded = await admin.auth.getAuth(app).verifyIdToken(idToken);
  return { uid: decoded.uid, email: decoded.email, name: decoded.name };
}

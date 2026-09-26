/**
 * Ambient typing for the lazily-loaded firebase-admin package (declared as
 * an optionalDependency, not installed by default). This lets the dynamic
 * `import("firebase-admin")` in firebase.ts typecheck without the package
 * being present; at runtime it is only loaded when Firebase auth is enabled.
 */
declare module "firebase-admin" {
  namespace admin {
    interface DecodedIdToken {
      uid: string;
      email?: string;
      name?: string;
    }
    interface Auth {
      verifyIdToken(idToken: string): Promise<DecodedIdToken>;
    }
    namespace credential {
      function cert(serviceAccount: object): unknown;
      function applicationDefault(): unknown;
    }
    namespace auth {
      function getAuth(app?: unknown): Auth;
    }
    function initializeApp(options?: {
      credential?: unknown;
      projectId?: string;
    }): unknown;
  }
  const admin: typeof admin;
  export = admin;
}

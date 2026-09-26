# Firebase Auth (optional, pluggable)

Local email/password auth (SQLite + JWT) is the **default** and always works
with zero extra setup. Firebase Authentication is an **optional** add-on:
when configured, users can sign in with a Firebase identity and the backend
exchanges their Firebase ID token for a regular local JWT — everything
downstream (devices, orgs, realtime) works exactly the same.

All of this uses the **Firebase Spark (free) plan** — no paid service, no
billing required.

## Setup (free tier)

1. Go to <https://console.firebase.google.com> and create a project (or use
   an existing one). The default Spark plan is free.
2. In the Firebase console: **Build → Authentication → Get started**, then
   enable a sign-in provider:
   - **Email/Password**, and/or
   - **Google**.
3. Note your **Project ID** (Project settings → General).

### Backend configuration

Set these env vars when starting the backend (see README for the env list):

| Variable | Required | Purpose |
|---|---|---|
| `FIREBASE_PROJECT_ID` | yes (to enable) | Turns Firebase auth on. Without it, `POST /api/auth/firebase` returns `501 firebase_auth_disabled`. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | no | The full service-account JSON (as a single-line string) if you run outside Google Cloud. If unset, the Admin SDK falls back to Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, gcloud auth, or GCE/GKE metadata). |

#### Generate the service account key (exact steps)

1. Open the [Firebase console](https://console.firebase.google.com) and
   select your project.
2. Click the gear icon → **Project settings**.
3. Open the **Service accounts** tab.
4. Click **Generate new private key**, then **Generate key** — a JSON file
   downloads.
5. On your **backend host** (not the dashboard), set the file contents as a
   single-line env var:
   ```sh
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"YOUR-PROJECT-ID",...}'
   ```
   (use the whole downloaded file contents on one line; keep the quotes).
   Never commit this file or value — put it in a gitignored `.env` on the
   server, a process manager's env config, or your host's secrets store. Never
   paste it into chat, docs, tickets, or the frontend.

#### Authorized domains

The Firebase console only allows authentication from listed domains. Add your
dashboard origins, otherwise sign-in is blocked by Firebase:

1. Firebase console → **Build → Authentication → Settings → Authorized
   domains**.
2. Click **Add domain** and add:
   - `localhost` (for local dev — the dashboard runs at
     `http://localhost:5173` by default; `localhost` covers all ports)
   - your production dashboard domain, e.g. `dashboard.example.com`
     (no scheme, no path).

### Dashboard configuration

The dashboard ships **no Firebase JS SDK**. To enable the email/password
Firebase form on the login page, copy the seven `VITE_FIREBASE_*` values
from Firebase console → Project settings → General → "Your apps" → your web
app into the gitignored `apps/dashboard/.env.local` (see
`apps/dashboard/.env.example` for the exact keys — placeholders only, real
values live in `.env.local` and are never committed).

> Note: this machine's `apps/dashboard/.env.local` is already preconfigured
> for project `chatdouble-13927`. If you use a different Firebase project,
> update `.env.local` (frontend) **and** `FIREBASE_PROJECT_ID` (backend).

`firebase-admin` is declared under `optionalDependencies` in
`apps/backend/package.json`, so default installs stay light. Only install it
when you actually enable Firebase:

```sh
cd apps/backend
npm install firebase-admin   # only needed when FIREBASE_PROJECT_ID is set
```

The backend imports it lazily (`await import("firebase-admin")`) only on the
Firebase path.

## Getting a user's ID token

The dashboard deliberately ships **no Firebase JS SDK** (keeps the bundle
dependency-free). There are two ways to sign in with Firebase:

### Option A — email/password form (recommended)

When the dashboard's `.env.local` contains the seven `VITE_FIREBASE_*`
values, the login page's **Continue with Firebase** panel shows an
email/password form. It signs in through the Firebase Auth REST API
(`POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`
with the configured `VITE_FIREBASE_API_KEY`), then automatically sends the
returned ID token to `POST /api/auth/firebase` and logs you in. No token
copy-paste needed.

The panel also displays the configured Firebase project ID so you know which
project's users can sign in, and keeps a manual paste-token fallback.

Prerequisite: the **Email/Password** provider must be enabled in Firebase
console → Build → Authentication → Sign-in method, and the account must
exist in that project. Common REST errors are surfaced as friendly messages
(no account → "No Firebase account found for that email",
wrong password → "Incorrect email or password",
disabled account → "This Firebase account has been disabled").

### Option B — paste an ID token (fallback)

Obtain a Firebase ID token from your own client and paste it in:

- From a Firebase client SDK: `await user.getIdToken()`.
- From the Firebase console: **Authentication → Users** shows users but not
  ID tokens — use a client app or the Auth REST API to sign in and grab one.

Then either:

- Dashboard: on the login page, click **Continue with Firebase** (shown only
  when the backend reports `"firebaseAuth": true` from `GET /api/meta`),
  then "Have an ID token? Paste it instead"; or
- SDK/CLI: `aiot login --token <firebase-id-token>` sends it to
  `POST /api/auth/firebase` and stores the returned local JWT. No SDK code
  changes were needed for this flow.

## How it works

- `GET /api/meta` → `{ ok, time, firebaseAuth }` (unauthenticated). The
  dashboard uses `firebaseAuth` to decide whether to show the Firebase button.
  `GET /api/health` is unchanged.
- `POST /api/auth/firebase` with body `{ idToken }`:
  - `501 { error: "firebase_auth_disabled" }` if Firebase isn't configured.
  - `401 { error: "invalid_firebase_token" }` if the token doesn't verify
    against the configured project (real verification via `firebase-admin` —
    no fake auth).
  - On success, find-or-create resolution:
    1. Look up `federated_identities` by `(provider='firebase', provider_uid=uid)`;
    2. else match `users.email` and create the link row;
    3. else create a new local user (random unusable password hash — the
       account can only sign in via Firebase), a personal workspace org with
       OWNER membership, and the link row.
  - Returns `{ token, user, orgs }` — the **same shape as
    `POST /api/auth/login`**, so the dashboard and SDK reuse the normal
    session handling (`setToken`, `/auth/me`).
- The link table lives in migration `002_federated_identities.sql`; the
  `users` table schema is untouched.

## Notes

- The backend never logs ID tokens or service-account material.
- Local password login for a Firebase-created account will always fail
  (the stored hash is random and unguessable) — that account signs in via
  Firebase only. Users created via normal registration can later link their
  Firebase identity by signing in with Firebase using the same email.

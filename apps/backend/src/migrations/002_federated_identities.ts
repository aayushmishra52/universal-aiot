/**
 * Federated identity links (pluggable auth providers, e.g. Firebase).
 *
 * Links an external provider identity (provider + provider_uid) to a local
 * users row, so the same person signing in via Firebase always resolves to
 * the same local user. A user matched by email gets a link row created; a
 * brand-new Firebase user gets a fresh local user + link row.
 */
export const name = "002_federated_identities.sql";

export const sql = `CREATE TABLE IF NOT EXISTS federated_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_uid)
);

CREATE INDEX IF NOT EXISTS idx_federated_identities_user
  ON federated_identities (user_id);
`;

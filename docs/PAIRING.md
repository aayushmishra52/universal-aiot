# Pairing

Pairing is how a device (physical ESP32 firmware from the `aiot-sdk` CLI, or
the `@aiot/virtual-device` simulator) binds to a device record in the
backend and receives its operational MQTT credentials.

## Credential model

Two credential kinds live side by side:

| Kind | Table | Purpose | Shown |
|---|---|---|---|
| **Pairing credential** | `pairings` | One-time onboarding secret for a device | **once**, at device creation |
| **Device credential** | `device_credentials` | Ongoing MQTT authentication | **once**, at pairing or rotation |

MQTT broker authentication accepts **either**: an unused, unexpired,
unrevoked pairing credential, or an active (unrevoked) device credential.
Both are bcrypt-verified; auth failures are logged **without** the password.

The pairing username is derived from the device id:
`device_` + device id with dashes removed, e.g. device `DEV-AB12CD3` →
username `device_DEVAB12CD3`.

## Lifecycle

1. **Generation.** `POST /api/projects/:projectId/devices` (project ADMIN)
   creates the device row **and** a pairing row in one transaction:
   - 24-char random pairing password (bcrypt-hashed in storage)
   - `expires_at = now + PAIRING_TTL_HOURS` (default 24 h)
   - The plaintext password is returned in the response **once** — the
     backend never shows it again.

2. **Device connects.** The device connects to the MQTT broker
   (`mqtt://host:1883`) with the pairing username/password. At this point
   it's authenticated but not yet fully onboarded — the broker allows the
   pairing credential only for the initial handshake.

3. **Exchange (one-time use).** `POST /api/pair` with
   `{ deviceId, username, password }` (authenticated user call, e.g. from
   the dashboard's Pair Device page):
   - Looks up an unused, unrevoked, unexpired pairing row for the triple;
     unknown/used/expired rows → `404 not_found` (deliberately, to avoid
     credential enumeration).
   - Verifies the password with bcrypt (`401 invalid_credentials` on
     mismatch).
   - In **one transaction**: marks the pairing row `used_at`, revokes all
     previous active device credentials for the device, and inserts a fresh
     device credential with a random 32-char device token (bcrypt-hashed).
   - Returns `{ ok, deviceId, projectId, orgId, rotated: true, deviceToken }`
     — the token is shown **once**.

4. **Operational.** The device authenticates to MQTT with the device
   username + device token from now on.

## Expiry

`PAIRING_TTL_HOURS` (default `24`) controls how long an unused pairing
credential stays valid. `pairingTtlMs` is computed at boot; changing the env
var and restarting applies the new TTL to **newly generated** pairings.
Existing rows keep their stored `expires_at`.

## Rotation

`POST /api/devices/:deviceId/credentials/rotate` (project ADMIN) revokes
all active device credentials for the device and issues a fresh 32-char
token (shown once). Use it when a token may have leaked, or when re-onboarding
a device. (To start over completely, create a **new** pairing by deleting
and re-creating the device, or just rotate — both work.)

## Revocation

Credentials are revoked (not deleted) — `revoked_at` is set — on:

- successful pairing (`POST /pair` revokes the *old* device credential; the
  pairing row itself is marked `used_at` so it can never be reused),
- explicit rotation,
- device deletion (`DELETE /devices/:deviceId` revokes pairings **and**
  device credentials, then removes the device).

A revoked or used credential immediately fails broker authentication and
`POST /pair`.

## Practical notes

- Copy the pairing password out of the create-device response (dashboard's
  Pair Device page shows it) into the device's config immediately; there's
  no "show it again" API by design.
- Pairing secrets are never printed in backend logs or the e2e report.
- In virtual mode (`npm run device:simulate`), pass the pairing username +
  password (or device token) via the CLI flags; the simulator behaves like
  firmware with respect to pairing.
- If a pairing credential expires before use, rotate isn't needed — just
  delete the device and re-create it (or re-pair with a fresh credential),
  because device creation mints a new pairing row each time.

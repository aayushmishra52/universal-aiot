# API Reference

Base URL: `{BACKEND}/api` (default `http://localhost:4000/api`).
Auth: `Authorization: Bearer <JWT>` on every route except `GET /health`,
`POST /auth/register`, `POST /auth/login`.

Conventions: request bodies are JSON validated with Zod; invalid bodies get
`400 { error: "invalid_request" }`. Access failures get `403`/`404` (see
notes). Device ids look like `DEV-XXXXXXX`.

## Auth

### `POST /auth/register`
Create a user; a personal org is created with the user as OWNER.

```json
{ "email": "a@example.com", "password": "…", "name": "Ada" }
```
→ `201 { user: { id, email, name }, org: { id, name }, token }`

### `POST /auth/login`
```json
{ "email": "a@example.com", "password": "…" }
```
→ `{ user, token }`. Rate-limited (strict auth limiter).

### `GET /auth/me`
→ `{ user }` for the bearer token.

## Orgs & projects

### `POST /orgs` / `GET /orgs`
Create an org (`{ name }`) / list orgs the caller belongs to.

### `POST /orgs/:orgId/members` (ADMIN)
Add a member by email: `{ email, role: "OWNER"|"ADMIN"|"MEMBER" }`. The last
OWNER cannot be demoted.

### `GET /orgs/:orgId/projects` / `POST /orgs/:orgId/projects`
List / create (`{ name }`) projects in an org.

## Devices

### `POST /projects/:projectId/devices` (ADMIN)
Create a device record. Body: `{ name, type?, model? }` → `201`:
```json
{
  "device": { "id": "DEV-AB12CD3", "name": "…", "status": "OFFLINE", … },
  "pairing": { "deviceId": "DEV-AB12CD3", "username": "device_DEVAB12CD3", "password": "…24-char…" }
}
```
**The pairing password is shown once.** Store it securely — give it to the
device, then forget it.

### `GET /projects/:projectId/devices`
List devices with status, last-seen, capability counts.

### `GET /devices/:deviceId`
Full detail: device fields, `capabilities[]` (from the manifest), `state`
(desired/reported), `health` (last health report) — or `null`s when the
device hasn't reported yet.

### `DELETE /devices/:deviceId` (ADMIN)
Deletes the device and revokes all pairing/device credentials.

### `POST /devices/:deviceId/credentials/rotate` (ADMIN)
Revokes current device credentials and issues a fresh 32-char device token,
shown **once**: `{ ok, deviceId, username, deviceToken }`.

### `GET /devices/:deviceId/telemetry`
Query: `?capability=<name>&from=<ms>&to=<ms>&limit=<n, max 1000, default 100>`.
→ `{ telemetry: [ { capabilityId, value, ts } … ] }`.

### `GET /devices/:deviceId/state`
→ `{ desired: {…}, reported: {…}, updatedAt }` — the device twin.

### `GET /devices/:deviceId/health`
→ last health payload (uptime, RSSI, …) or `null`.

### `GET /devices/:deviceId/events`
Audit/event feed for the device (pairing, commands, deletes).

## Pairing

### `POST /pair`
Exchanges a one-time pairing credential for an operational device token.

```json
{ "deviceId": "DEV-AB12CD3", "username": "device_DEVAB12CD3", "password": "<pairing password>" }
```
→ `{ ok: true, deviceId, projectId, orgId, rotated: true, deviceToken }`.
The pairing row is marked used, previous device credentials are revoked, and
the new 32-char `deviceToken` is shown once. Lifecycle: [docs/PAIRING.md](PAIRING.md).

## Commands

### `POST /devices/:deviceId/commands` (ADMIN)
```json
{ "capabilityId": "fan", "action": "set", "params": { "speed": 2 }, "ttlMs": 30000 }
```
`ttlMs` defaults to 30 000, max 3 600 000. → `201 { command: { commandId,
status: "PENDING", issuedAt, expiresAt, … } }`. The command is published to
the device's `…/command` topic; results come back on the same topic and
update the status (PENDING → SUCCEEDED / FAILED); the sweeper marks EXPIRED.

### `GET /devices/:deviceId/commands`
`?limit=` (max 200, default 50). → `{ commands: […] }`.

## Automations

Rules evaluate on each telemetry ingest: `condition` compares a
capability's value against a threshold; when it holds, the `action` is
executed (e.g. issue a command). Rules are project-scoped, optionally
device-scoped.

- `GET /projects/:projectId/automations` — list.
- `POST /projects/:projectId/automations` (ADMIN) — create:
  `{ name, deviceId?, enabled, condition: { capabilityId, op, value }, action: { … } }`.
- `GET /projects/:projectId/automations/:automationId` — detail.
- `PUT /projects/:projectId/automations/:automationId` (ADMIN) — update.
- `DELETE /projects/:projectId/automations/:automationId` (ADMIN) — delete.
- `GET /projects/:projectId/automations/:automationId/runs` — run history.

## Meta

### `GET /health`
No auth. → `{ ok: true, … }` service health.

## Realtime WebSocket

`ws://host:4001` (see `VITE_WS_URL`). Protocol:
1. First message must be `{ "type": "auth", "token": "<JWT>" }` within 5s or
   the socket is closed.
2. Then `{ "type": "subscribe", "projectId": "…" }` (membership verified).
3. Server pushes `{ "type": "event", "event": { … } }` — telemetry, device
   status/presence, command results, automation runs.

## Error model

| Status | Meaning |
|---|---|
| 400 | `invalid_request` (schema validation failed), `invalid_device`, `last_owner` |
| 401 | `invalid_credentials` (wrong pairing password / bad login) |
| 403 | access denied (wrong org / insufficient role) |
| 404 | `not_found` — also returned for unknown/used/expired/revoked pairings to avoid enumeration |

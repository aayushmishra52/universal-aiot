# Device credentials

Devices authenticate to the MQTT broker with a **clientId / secret** pair
issued per device. The secret is shown **exactly once** at issuance; only its
bcrypt hash is stored. Credentials can be listed and revoked from the
dashboard or the API, and `last_used_at` is updated by the broker on every
successful authentication.

## Issuing credentials (API)

All three endpoints require an **ADMIN** role on the device's organization.

```http
POST /api/devices/:deviceId/credentials
Content-Type: application/json

{ "label": "rooftop sensor", "scopes": ["telemetry", "commands"] }
```

```jsonc
// 201 — `secret` is PLAINTEXT and returned only here, never again
{
  "id": "…",
  "clientId": "dc_51VC6BVYFYZXOIQV",
  "secret": "BAYEXXXMDOU63EHAP8BX9N8F3707EYV7H6884POCVXZ2Q2BY",
  "label": "rooftop sensor",
  "scopes": ["telemetry", "commands"],
  "createdAt": 1758900000000
}
```

```http
GET /api/devices/:deviceId/credentials     # metadata list — never secret/hash
DELETE /api/devices/:deviceId/credentials/:credId   # revoke (row kept, revoked_at set)
```

`POST /api/devices/:deviceId/credentials/rotate` (legacy) still works: it
revokes every active credential for the device and returns a one-time
`deviceToken` under the device's pairing username.

A device may hold **multiple** active credentials (distinguish them with
`label`); rotate is the "replace everything" operation.

## MQTT authentication

Connect with the credential as the MQTT username/password:

```
username: dc_51VC6BVYFYZXOIQV
password: <the one-time secret>
```

The broker binds each authenticated client to exactly one device. The client
may only **publish** under `aiot/v1/{orgId}/{projectId}/{deviceId}/#` and may
only **subscribe** to its own `…/command` topic — anything else is rejected.
Pairing credentials (`POST /api/pair`) keep working unchanged.

## Dashboard

Open a device on the Devices page → **🔑 Credentials**. The modal provisions
new credentials (label + scopes), shows the secret once with copy buttons and
**Download .env / Download JSON**, and lists existing credentials with revoke
buttons.

## CLI (`aiot-sdk`)

```bash
# Sign in once; token stored at ~/.config/aiot-sdk/config.json (0600)
aiot-sdk login
# …or store a token directly (also accepts Firebase ID tokens)
aiot-sdk login --token <jwt> --api-url https://api.example.com

aiot-sdk devices
aiot-sdk provision --device DEV-ABC123 --out ./aiot.credentials.env --label "field unit"
aiot-sdk init --credentials-file ./aiot.credentials.env --project-dir ./my-firmware
```

`provision` writes `AIOT_MQTT_URL` / `AIOT_MQTT_USER` / `AIOT_MQTT_PASSWORD`
(0600). `init` injects the user/password into a generated project's
`config/config.h` (`MQTT_USER` / `MQTT_PASS`), keeping the existing Wi-Fi and
broker settings. The same `mqttUser` / `mqttPass` template variables are
honored by `aiot-sdk create --mqtt-user … --mqtt-pass …`.

## Running the backend "from anywhere"

Devices outside your LAN need a reachable broker and API. Two options:

### Option A — self-host the backend on a VPS

Deploy the backend on any VPS (or a free tier: Render, Railway, Fly.io).
Set the advertised public URLs so the dashboard and `aiot-sdk provision`
hand devices the right address:

```bash
PUBLIC_MQTT_URL=mqtt://broker.example.com:1883
PUBLIC_API_URL=https://api.example.com
```

These are served in `GET /api/devices/:deviceId` as `connectivity.mqttUrl` /
`connectivity.apiUrl`.

Optional TLS (bring your own certs):

```bash
MQTT_TLS_KEY=/etc/ssl/private/mqtt.key     # broker listens TLS on MQTT_TLS_PORT
MQTT_TLS_CERT=/etc/ssl/certs/mqtt.crt       # (default 8883) when BOTH are set
TLS_KEY=/etc/ssl/private/api.key            # HTTPS for the API
TLS_CERT=/etc/ssl/certs/api.crt
```

### Option B — use a free external broker instead of embedded aedes

Point `PUBLIC_MQTT_URL` at a free managed broker (HiveMQ Cloud free tier,
EMQX Cloud free tier) and provision the **same** clientId/secret there as an
ACL'd user (publish/subscribe restricted to
`aiot/v1/{orgId}/{projectId}/{deviceId}/#`). The backend keeps ingesting via
its bridge/subscription; device onboarding (`provision` → `init`) is unchanged
because every tool reads the URL from the backend's advertised connectivity.

## Security notes

- Secrets are never logged, never stored in plaintext, and never returned by
  `GET`. The audit log records issuance/revocation metadata only.
- Revocation is immediate: the broker checks `revoked_at IS NULL` on every
  CONNECT.
- `client_id` is unique among active credentials; revoked rows are kept for
  audit and can never be reactivated.
- The dotenv/config files holding secrets are written with `0600` and
  `config.h` is gitignored by the generator — do not commit them.

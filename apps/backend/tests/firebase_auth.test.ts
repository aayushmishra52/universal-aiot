import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, startTestServer, type ServerHandles } from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  // Firebase auth must be disabled for these tests: no FIREBASE_PROJECT_ID.
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe("firebase auth (disabled by default)", () => {
  it("GET /api/meta reports firebaseAuth:false and keeps health fields", async () => {
    const res = await api(server.httpUrl)("GET", "/api/meta");
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.time).toBeTypeOf("number");
    expect(res.json.firebaseAuth).toBe(false);
  });

  it("GET /api/health keeps its existing shape", async () => {
    const res = await api(server.httpUrl)("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.time).toBeTypeOf("number");
  });

  it("POST /api/auth/firebase returns 501 when Firebase is not configured", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/firebase", {
      idToken: "some-token",
    });
    expect(res.status).toBe(501);
    expect(res.json.error).toBe("firebase_auth_disabled");
  });

  it("POST /api/auth/firebase returns 501 even with a missing idToken (disabled check first)", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/firebase", {});
    expect(res.status).toBe(501);
    expect(res.json.error).toBe("firebase_auth_disabled");
  });
});

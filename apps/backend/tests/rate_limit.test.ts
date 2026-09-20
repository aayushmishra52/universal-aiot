import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, registerUser, startTestServer, type ServerHandles } from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  // Aggressive limiter so the test does not need hundreds of requests.
  server = await startTestServer({ rateLimitAuthPerMin: 5 });
});

afterAll(async () => {
  await server.stop();
});

describe("rate limiting", () => {
  it("returns 429 after bursting past the auth rate limit", async () => {
    await registerUser(server, "Rate User", "rate@example.com", "password123");
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await api(server.httpUrl)("POST", "/api/auth/login", {
        email: "rate@example.com",
        password: "wrong-password",
      });
      statuses.push(res.status);
    }
    // First 5 attempts are processed (401), the rest are rate limited.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, registerUser, startTestServer, type ServerHandles } from "./helpers.js";

let server: ServerHandles;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe("auth", () => {
  it("registers a user, creating a personal org with OWNER membership", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/register", {
      name: "Ada",
      email: "ada@example.com",
      password: "s3cret-pass",
    });
    expect(res.status).toBe(201);
    expect(res.json.token).toBeTypeOf("string");
    expect(res.json.user.email).toBe("ada@example.com");
    expect(res.json.org.name).toBe("Ada's workspace");

    const me = await api(server.httpUrl, res.json.token)("GET", "/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.json.orgs).toHaveLength(1);
    expect(me.json.orgs[0].role).toBe("OWNER");
  });

  it("rejects duplicate email with 409", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/register", {
      name: "Ada Clone",
      email: "ada@example.com",
      password: "another-pass",
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("email_taken");
  });

  it("rejects invalid registration bodies with 400", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/register", {
      name: "No Email",
      password: "short",
    });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and returns orgs", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/login", {
      email: "ada@example.com",
      password: "s3cret-pass",
    });
    expect(res.status).toBe(200);
    expect(res.json.token).toBeTypeOf("string");
    expect(res.json.user.email).toBe("ada@example.com");
    expect(res.json.orgs).toHaveLength(1);
    expect(res.json.orgs[0].role).toBe("OWNER");
  });

  it("rejects wrong password with 401", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/login", {
      email: "ada@example.com",
      password: "wrong-pass",
    });
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("invalid_credentials");
  });

  it("rejects unknown email with 401", async () => {
    const res = await api(server.httpUrl)("POST", "/api/auth/login", {
      email: "nobody@example.com",
      password: "whatever",
    });
    expect(res.status).toBe(401);
  });

  it("requires a bearer token for /auth/me", async () => {
    const noToken = await api(server.httpUrl)("GET", "/api/auth/me");
    expect(noToken.status).toBe(401);
    const badToken = await api(server.httpUrl, "bogus")("GET", "/api/auth/me");
    expect(badToken.status).toBe(401);
  });

  it("never stores plaintext passwords", async () => {
    await registerUser(server, "Hash Check", "hashcheck@example.com", "my-password");
    const row = server.db
      .prepare("SELECT password_hash FROM users WHERE email = ?")
      .get("hashcheck@example.com") as { password_hash: string };
    expect(row.password_hash).not.toContain("my-password");
    expect(row.password_hash.startsWith("$2")).toBe(true);
  });
});

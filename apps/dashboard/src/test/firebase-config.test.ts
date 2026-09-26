import { afterEach, describe, expect, it, vi } from "vitest";
import {
  friendlyFirebaseError,
  isFirebaseConfigured,
  signInWithFirebaseRest,
  type FirebaseWebConfig,
} from "../firebase-config";

const cfg: FirebaseWebConfig = {
  apiKey: "test-api-key",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  storageBucket: "proj.firebasestorage.app",
  messagingSenderId: "123",
  appId: "1:123:web:abc",
  measurementId: "",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("firebase REST sign-in helper", () => {
  it("posts credentials to the Identity Toolkit endpoint and returns the ID token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        idToken: "firebase-id-token-abc",
        email: "user@example.com",
        localId: "uid-1",
        refreshToken: "rt",
        expiresIn: "3600",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await signInWithFirebaseRest("user@example.com", "s3cret", cfg);
    expect(res).toEqual({
      idToken: "firebase-id-token-abc",
      email: "user@example.com",
      localId: "uid-1",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword");
    expect(url).toContain("key=test-api-key");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "user@example.com",
      password: "s3cret",
      returnSecureToken: true,
    });
  });

  it("maps common REST errors to friendly messages", async () => {
    const cases: Array<[string, string]> = [
      ["INVALID_PASSWORD", "Incorrect email or password."],
      ["EMAIL_NOT_FOUND", "No Firebase account found for that email."],
      ["USER_DISABLED", "This Firebase account has been disabled."],
    ];
    for (const [code, message] of cases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ error: { message: code, code: 400 } }, 400)),
      );
      await expect(signInWithFirebaseRest("u@e.com", "x", cfg)).rejects.toThrow(message);
    }
    // Error strings with a trailing detail after a colon still map correctly.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "INVALID_PASSWORD : Wrong password.", code: 400 } }, 400)),
    );
    await expect(signInWithFirebaseRest("u@e.com", "x", cfg)).rejects.toThrow(
      "Incorrect email or password.",
    );
    // Unknown codes surface with the code attached.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "SOME_NEW_ERROR", code: 400 } }, 400)),
    );
    await expect(signInWithFirebaseRest("u@e.com", "x", cfg)).rejects.toThrow(
      "Firebase sign-in failed (SOME_NEW_ERROR).",
    );
  });

  it("refuses to call the API without a configured API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      signInWithFirebaseRest("u@e.com", "x", { ...cfg, apiKey: "" }, fetchMock),
    ).rejects.toThrow("Firebase is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isFirebaseConfigured requires at least apiKey + projectId", () => {
    expect(isFirebaseConfigured(cfg)).toBe(true);
    expect(isFirebaseConfigured({ ...cfg, apiKey: "" })).toBe(false);
    expect(isFirebaseConfigured({ ...cfg, projectId: "" })).toBe(false);
    expect(isFirebaseConfigured(null)).toBe(false);
  });

  it("friendlyFirebaseError covers the common codes", () => {
    expect(friendlyFirebaseError("EMAIL_NOT_FOUND")).toContain("No Firebase account");
    expect(friendlyFirebaseError("INVALID_LOGIN_CREDENTIALS")).toBe("Incorrect email or password.");
    expect(friendlyFirebaseError("USER_DISABLED")).toContain("disabled");
    expect(friendlyFirebaseError("WHATEVER")).toContain("WHATEVER");
  });
});

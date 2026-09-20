import jwt from "jsonwebtoken";

export interface AuthTokenClaims {
  sub: string;
  email: string;
}

/** Sign an HS256 auth token. */
export function signToken(
  claims: AuthTokenClaims,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign({ sub: claims.sub, email: claims.email }, secret, {
    algorithm: "HS256",
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}

/** Verify a token, returning claims or null. Never throws. */
export function verifyToken(token: string, secret: string): AuthTokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
      sub?: unknown;
      email?: unknown;
    };
    if (typeof decoded.sub !== "string" || typeof decoded.email !== "string") {
      return null;
    }
    return { sub: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}

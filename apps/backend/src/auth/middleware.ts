import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "./jwt.js";

/**
 * Fastify preHandler: parses the Bearer token and attaches
 * `{ userId, email }` to the request, or replies 401.
 * Tokens and secrets are never logged.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  const claims = verifyToken(header.slice("Bearer ".length), request.server.config.jwtSecret);
  if (!claims) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  request.user = { userId: claims.sub, email: claims.email };
}

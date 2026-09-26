import type { FastifyInstance } from "fastify";
import { isFirebaseEnabled } from "../auth/firebase.js";
import { nowMs } from "../util.js";

export default async function metaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => {
    return { ok: true, time: nowMs() };
  });

  // Unauthenticated capability discovery. Shape extends /health with the
  // firebaseAuth flag the dashboard uses to decide whether to offer the
  // "Continue with Firebase" flow.
  fastify.get("/meta", async () => {
    return { ok: true, time: nowMs(), firebaseAuth: isFirebaseEnabled() };
  });
}

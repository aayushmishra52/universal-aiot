import type { FastifyInstance } from "fastify";
import { nowMs } from "../util.js";

export default async function metaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async () => {
    return { ok: true, time: nowMs() };
  });
}

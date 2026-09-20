import type { Database } from "better-sqlite3";
import type { AppConfig } from "./config.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
    config: AppConfig;
  }
  interface FastifyRequest {
    user?: { userId: string; email: string };
  }
}

export {};

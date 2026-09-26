import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { readFileSync } from "node:fs";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Database } from "better-sqlite3";
import {
  loadConfig,
  type AppConfig,
  type ConfigOverrides,
} from "./config.js";
import { openDatabase } from "./db.js";
import { startBroker, type BrokerHandles } from "./mqtt/broker.js";
import { setBroker } from "./mqtt/publish.js";
import { attachIngest } from "./mqtt/ingest.js";
import { startRealtime, type RealtimeHandles } from "./realtime.js";
import { startSweeper, type SweeperHandle } from "./services/sweeper.js";
import authRoutes from "./routes/auth.js";
import orgRoutes from "./routes/orgs.js";
import deviceRoutes from "./routes/devices.js";
import pairingRoutes from "./routes/pairing.js";
import commandRoutes from "./routes/commands.js";
import automationRoutes from "./routes/automations.js";
import metaRoutes from "./routes/meta.js";
import "./types.js";

export interface ServerHandles {
  config: AppConfig;
  db: Database;
  fastify: FastifyInstance;
  broker: BrokerHandles;
  realtime: RealtimeHandles;
  sweeper: SweeperHandle;
  httpUrl: string;
  mqttPort: number;
  wsPort: number;
  stop: () => Promise<void>;
}

/**
 * Boot the full backend: config -> database -> MQTT broker (+ingest) ->
 * HTTP API -> realtime WS -> command sweeper. Ports may be 0 for ephemeral
 * assignment (used by tests).
 */
export async function startServer(
  overrides: ConfigOverrides = {},
): Promise<ServerHandles> {
  const config = loadConfig(overrides);
  const db = openDatabase(config);

  const broker = await startBroker(db, config);
  setBroker(broker.aedes);
  attachIngest(db, broker.aedes);

  // HTTPS is enabled only when BOTH TLS_KEY and TLS_CERT are set.
  const fastifyOptions = { logger: false } as FastifyServerOptions & {
    https?: { key: string; cert: string };
  };
  if (config.tlsKey && config.tlsCert) {
    fastifyOptions.https = {
      key: readFileSync(config.tlsKey, "utf8"),
      cert: readFileSync(config.tlsCert, "utf8"),
    };
  }
  const fastify: FastifyInstance = Fastify(
    fastifyOptions as FastifyServerOptions,
  );
  await fastify.register(helmet);
  await fastify.register(cors, { origin: true });
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimitGlobalPerMin,
    timeWindow: "1 minute",
  });
  fastify.decorate("db", db);
  fastify.decorate("config", config);

  fastify.setErrorHandler((error, _request, reply) => {
    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: "request_error" });
    }
    console.error("[http] internal error:", (error as Error)?.message ?? error);
    return reply.code(500).send({ error: "internal_error" });
  });
  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: "not_found" });
  });

  await fastify.register(authRoutes, { prefix: "/api" });
  await fastify.register(orgRoutes, { prefix: "/api" });
  await fastify.register(deviceRoutes, { prefix: "/api" });
  await fastify.register(pairingRoutes, { prefix: "/api" });
  await fastify.register(commandRoutes, { prefix: "/api" });
  await fastify.register(automationRoutes, { prefix: "/api" });
  await fastify.register(metaRoutes, { prefix: "/api" });

  await fastify.listen({ port: config.port, host: config.httpHost });
  const httpPort = (fastify.server.address() as { port: number }).port;
  const scheme = config.tlsKey && config.tlsCert ? "https" : "http";
  const httpUrl = `${scheme}://${config.httpHost}:${httpPort}`;
  console.log(`[http] api listening on ${httpUrl}`);

  const realtime = await startRealtime(db, config);
  const sweeper = startSweeper(db, config);

  return {
    config,
    db,
    fastify,
    broker,
    realtime,
    sweeper,
    httpUrl,
    mqttPort: broker.port,
    wsPort: realtime.port,
    stop: async () => {
      sweeper.stop();
      await realtime.close();
      await fastify.close();
      await broker.close();
      db.close();
    },
  };
}

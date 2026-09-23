import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import express from "express";
import helmet from "helmet";
import { AccessGuard, AuthService } from "./auth";
import { CatalogService } from "./catalog";
import { config } from "./config";
import { ApiController } from "./controllers";
import { Db } from "./db";
import { Errors } from "./http";
import { OrdersService } from "./orders";
import { ChangeBus, attachRealtime } from "./realtime";
import { StaffService } from "./staff";
import { Writes } from "./writes";
import { SchedulingService } from "./scheduling";
import { Mailer } from "./mailer";
import { AnalyticsService } from "./analytics";

@Module({
  controllers: [ApiController],
  providers: [
    Db,
    AuthService,
    CatalogService,
    OrdersService,
    StaffService,
    Writes,
    ChangeBus,
    SchedulingService,
    Mailer,
    AnalyticsService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}

export async function createApp(quiet = false) {
  const env = config();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    ...(quiet ? { logger: false as const } : {}),
  });
  app
    .getHttpAdapter()
    .getInstance()
    .set("trust proxy", env.trustedProxies.length ? env.trustedProxies : false);
  app.use(
    (
      req: express.Request & { requestId: string },
      res: express.Response,
      next: express.NextFunction,
    ) => {
      req.requestId = randomUUID();
      res.setHeader("X-Request-Id", req.requestId);
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.enableCors({
    origin: env.origins,
    credentials: false,
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id", "X-Session-Expires-At"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new Errors());
  if (env.DOCS_ENABLED === "true") {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Bonamassa API")
        .setDescription(
          "Valores em centavos. Horários ISO 8601. Login fornece um token Bearer revogável. As mutações exigem Idempotency-Key e as edições exigem expectedVersion.",
        )
        .setVersion("0.1.0")
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("v1/docs", app, doc, {
      jsonDocumentUrl: "/v1/openapi.json",
      swaggerOptions: { persistAuthorization: false },
    });
  }
  const closeRealtime = attachRealtime(
    app.getHttpServer(),
    app.get(AuthService),
    app.get(ChangeBus),
    env.origins,
  );
  app.enableShutdownHooks();
  const close = app.close.bind(app);
  app.close = async () => {
    await closeRealtime();
    await close();
  };
  return app;
}

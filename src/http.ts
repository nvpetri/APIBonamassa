import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  applyDecorators,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiResponse } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { RuleError } from "./domain";

export const BodyDoc = (schema: z.ZodType) =>
  ApiBody({
    schema: z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
      target: "openapi-3.0",
    }) as SchemaObject,
  });
export const Mutation = () =>
  applyDecorators(
    ApiHeader({
      name: "Idempotency-Key",
      required: true,
      description:
        "UUID persistido antes do envio. Repita a mesma chave e corpo nos retries.",
      schema: { type: "string", minLength: 16, maxLength: 100 },
    }),
    ApiResponse({
      status: 409,
      description:
        "Conflito de versão, cotação ou chave. Reconsulte o recurso antes de tentar novamente.",
    }),
  );
@Catch()
export class Errors implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");
  catch(error: unknown, host: ArgumentsHost) {
    const req = host
      .switchToHttp()
      .getRequest<Request & { requestId: string }>();
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Não foi possível concluir a operação.";
    let details: unknown;
    if (error instanceof RuleError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = "INVALID_INPUT";
      message = "Confira os campos enviados.";
      details = error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        status = 409;
        code = "DUPLICATE";
        message =
          "Já existe um registro com este identificador, nome ou e-mail.";
      }
      if (error.code === "P2003" || error.code === "P2025") {
        status = 404;
        code = "NOT_FOUND";
        message = "Um recurso necessário não foi encontrado.";
      }
      if (error.code === "P2034" || error.code === "P2028") {
        status = 503;
        code = "RETRY_LATER";
        message =
          "Operação concorrente. Reenvie com a mesma chave de idempotência.";
      }
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = status === 413 ? "PAYLOAD_TOO_LARGE" : "HTTP_ERROR";
      message = error.message;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "O corpo enviado excede o limite.";
    } else if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      status = 400;
      code = "INVALID_JSON";
      message = "O corpo deve conter JSON válido.";
    }
    if (status >= 500)
      this.logger.error({
        requestId: req.requestId,
        code,
        errorType: error instanceof Error ? error.name : "Unknown",
      });
    if (status === 429) res.setHeader("Retry-After", "900");
    res.status(status).json({
      code,
      message,
      requestId: req.requestId,
      ...(details ? { details } : {}),
    });
  }
}

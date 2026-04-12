import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtro global de excepciones.
 * Captura TODOS los errores (HttpException + errores no controlados como DB errors).
 *
 * En producción nunca expone el stack trace al cliente.
 * Estructura de respuesta uniforme:
 *
 * {
 *   statusCode: 400,
 *   timestamp: "2025-03-15T14:00:00.000Z",
 *   path: "/api/v1/bookings",
 *   message: "Descripción del error"
 * }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: unknown;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const isObject = typeof exceptionResponse === 'object' && exceptionResponse !== null;

      message = isObject
        ? (exceptionResponse as any).message || exception.message
        : (exceptionResponse as string) || exception.message;

      errorCode = isObject ? (exceptionResponse as any).errorCode : undefined;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Ha ocurrido un error interno. Por favor, contacte al administrador.';
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400 && status !== HttpStatus.UNAUTHORIZED) {
      this.logger.warn(
        `[${request.method}] ${request.url} → ${status} | ${JSON.stringify(message)}`,
      );
    }

    const body: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };
    if (errorCode) body['errorCode'] = errorCode;

    response.status(status).json(body);
  }
}

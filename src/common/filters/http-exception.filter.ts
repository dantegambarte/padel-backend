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
 * Filtro global de excepciones HTTP.
 * Transforma todos los errores a una estructura de respuesta uniforme:
 *
 * {
 *   statusCode: 400,
 *   timestamp: "2025-03-15T14:00:00.000Z",
 *   path: "/api/v1/bookings",
 *   message: "Descripción del error"
 * }
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();
    const isObject = typeof exceptionResponse === 'object' && exceptionResponse !== null;

    const message = isObject
      ? (exceptionResponse as any).message || exception.message
      : (exceptionResponse as string) || exception.message;

    // Preservar errorCode si el servicio lo incluyó (ej. CAJA_CERRADA)
    const errorCode: string | undefined = isObject
      ? (exceptionResponse as any).errorCode
      : undefined;

    // Log de errores de servidor (5xx)
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status} ${JSON.stringify(message)}`,
        exception.stack,
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

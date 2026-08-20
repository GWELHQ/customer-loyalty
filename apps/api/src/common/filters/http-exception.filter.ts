import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/** Normalizes every thrown error into one consistent JSON error shape. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttp ? exception.getResponse() : null;

    const message =
      typeof body === 'object' && body && 'message' in body
        ? (body as { message: string | string[] }).message
        : isHttp
          ? exception.message
          : 'Internal server error';

    if (!isHttp) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(payload);
  }
}

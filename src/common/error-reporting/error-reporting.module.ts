import { Global, Module } from '@nestjs/common';

import { ErrorReporter } from './error-reporter';
import { LoggerErrorReporter } from './logger-error-reporter';

@Global()
@Module({
  providers: [{ provide: ErrorReporter, useFactory: () => new LoggerErrorReporter() }],
  exports: [ErrorReporter],
})
export class ErrorReportingModule {}

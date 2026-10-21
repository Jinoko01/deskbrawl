import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { Config } from './config';
import { HttpErrors } from './http-errors.filter';
export { Database } from './database';
export { SimulationEngine } from './game/simulation';
export { VisitSessionService } from './modules/visit-session.service';

export async function createApp(
  config: Config,
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    { logger: ['error', 'warn'], bodyParser: false },
  );
  app.useBodyParser('json', { limit: '8kb' });
  app.enableCors({ origin: config.origins });
  app.useGlobalFilters(new HttpErrors());
  app.enableShutdownHooks();
  return app;
}

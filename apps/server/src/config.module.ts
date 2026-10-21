import type { DynamicModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import type { Config } from './config';
import { CONFIG } from './config';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}

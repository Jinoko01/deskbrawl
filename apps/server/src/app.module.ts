import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { Config } from './config';
import { ConfigModule } from './config.module';
import { AuthModule } from './modules/auth';
import { InvitesModule } from './modules/invites';
import { RoomsModule } from './modules/rooms';
import { VisitsModule } from './modules/visits';
import { PrismaModule } from './prisma.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        RoomsModule,
        InvitesModule,
        VisitsModule,
      ],
      controllers: [PublicController],
      providers: [PublicService],
    };
  }
}

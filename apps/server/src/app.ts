import "reflect-metadata";
import { Controller, Get, Global, Inject, Module, Param, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Response } from "express";
import { tokenSchema } from "@deskbrawl/protocol";
import { CONFIG } from "./config";
import type { Config } from "./config";
import { Database, PrismaModule } from "./database";
import { HttpErrors } from "./errors";
import { AuthModule } from "./modules/auth";
import { RoomsModule } from "./modules/rooms";
import { InvitesModule } from "./modules/invites";
import { VisitsModule } from "./modules/visits";
export { SimulationEngine } from "./game/simulation";
export { VisitSessionService } from "./modules/visits";
export { Database } from "./database";

@Controller()
class PublicController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Get("health") async health() { await this.db.$queryRaw`SELECT 1`; return { ok: true }; }
  @Get("join/:token") landing(@Param("token") raw: string, @Res() res: Response) {
    const token = tokenSchema.parse(raw);
    res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff" });
    res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DeskBrawl 방문</title><h1>DeskBrawl 방문</h1><p><a href="deskbrawl://join/${token}">앱에서 방문하기</a></p><p>DeskBrawl Windows 앱이 설치되어 있어야 합니다. 앱이 없다면 링크를 보관한 뒤 호스트에게 설치 파일을 요청해 주세요.</p></html>`);
  }
}
export async function createApp(config: Config) {
  @Global()
  @Module({ providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] })
  class ConfigModule {}
  @Module({ imports: [ConfigModule, PrismaModule, AuthModule, RoomsModule, InvitesModule, VisitsModule], controllers: [PublicController] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn"], bodyParser: false });
  app.useBodyParser("json", { limit: "8kb" });
  app.enableCors({ origin: config.origins });
  app.useGlobalFilters(new HttpErrors());
  app.enableShutdownHooks();
  return app;
}

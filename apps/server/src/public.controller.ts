import { tokenSchema } from '@deskbrawl/protocol';
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicService } from './public.service';

@Controller()
export class PublicController {
  constructor(@Inject(PublicService) private readonly service: PublicService) {}

  @Get('health')
  health(): Promise<{ ok: true }> {
    return this.service.health();
  }

  @Get('join/:token')
  landing(@Param('token') raw: string, @Res() res: Response): void {
    const token = tokenSchema.parse(raw);
    res.set({
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    const html = [
      '<!doctype html>',
      '<html lang="ko">',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width">',
      '<title>DeskBrawl 방문</title>',
      '<h1>DeskBrawl 방문</h1>',
      `<p><a href="deskbrawl://join/${token}">앱에서 방문하기</a></p>`,
      '<p>DeskBrawl Windows 앱이 설치되어 있어야 합니다. ' +
        '앱이 없다면 링크를 보관한 뒤 호스트에게 설치 파일을 요청해 주세요.</p>',
      '</html>',
    ].join('');
    res.type('html').send(html);
  }
}

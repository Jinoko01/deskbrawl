import { createHash } from 'node:crypto';
import { tokenSchema } from '@deskbrawl/protocol';
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { inviteLandingStyles } from './invite-landing.styles';
import { PublicService } from './public.service';

const downloadUrl = 'https://www.deskbrawl.xyz/';
const mascotUrl = `${downloadUrl}face.png`;
const styleHash = createHash('sha256')
  .update(inviteLandingStyles)
  .digest('base64');

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
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; " +
        `style-src 'sha256-${styleHash}'; img-src ${mascotUrl}`,
      'X-Content-Type-Options': 'nosniff',
    });
    const html = [
      '<!doctype html>',
      '<html lang="ko">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>DeskBrawl 방문</title>',
      '<meta name="description" content="DeskBrawl 앱에서 친구의 초대를 열어 보세요.">',
      `<style>${inviteLandingStyles}</style>`,
      '</head>',
      '<body>',
      '<main class="invite">',
      `<img src="${mascotUrl}" alt="" width="64" height="48">`,
      '<h1>DeskBrawl 방문</h1>',
      '<p>DeskBrawl Windows 앱이 설치되어 있어야 합니다.</p>',
      '<div class="actions">',
      `<a class="primary" href="deskbrawl://join/${token}">앱에서 방문하기</a>`,
      `<a href="${downloadUrl}" target="_blank" rel="noopener noreferrer" ` +
        'aria-label="deskbrawl 다운 받으러 가기 (새 탭)">deskbrawl 다운 받으러 가기</a>',
      '</div>',
      '</main>',
      '</body>',
      '</html>',
    ].join('');
    res.type('html').send(html);
  }
}

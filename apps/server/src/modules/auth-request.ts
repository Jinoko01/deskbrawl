import type { Request } from 'express';

export type AuthRequest = Request & { deviceId: string };

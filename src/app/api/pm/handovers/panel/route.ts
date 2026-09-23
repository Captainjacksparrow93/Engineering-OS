import type { NextRequest } from 'next/server';
import { requirePrincipal } from '@/core/auth/session';
import { handler, ok } from '@/core/http/api';
import { requestPanelHandover } from '@/modules/project-management/services/handover.service';

export const POST = handler(async (req: NextRequest) => {
  const principal = await requirePrincipal();
  const body = await req.json();
  const result = await requestPanelHandover(principal, {
    phaseTaskId: body.phaseTaskId,
    toUserId: body.toUserId,
    reason: body.reason,
  });
  return ok(result);
});

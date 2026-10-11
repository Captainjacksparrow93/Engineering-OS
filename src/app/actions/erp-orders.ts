'use server';

import { requirePrincipal } from '@/core/auth/session';
import { isClientSafeError } from '@/core/rbac/errors';
import { ERP_UNAVAILABLE_MESSAGE } from '@/modules/erp/client';
import {
  getOrderForProject,
  listWaitingOrders,
  type ProjectOrderInput,
  type WaitingOrder,
} from '@/modules/erp/order.service';

type Result<T> = { success: true; data: T } | { success: false; error: string };

function failure(error: unknown, what: string): { success: false; error: string } {
  if (error instanceof Error && isClientSafeError(error)) return { success: false, error: error.message };
  console.error(`[erp] ${what} failed`, error instanceof Error ? error.message : String(error));
  return { success: false, error: ERP_UNAVAILABLE_MESSAGE };
}

/** Confirmed sales orders that have no project yet (New project, step 0). */
export async function listWaitingOrdersAction(): Promise<Result<WaitingOrder[]>> {
  const principal = await requirePrincipal();
  try {
    return { success: true, data: await listWaitingOrders(principal) };
  } catch (error) {
    return failure(error, 'listing waiting orders');
  }
}

/** The picked order as New project's prefill. The server reads it again on save. */
export async function getSalesOrderAction(orderName: string): Promise<Result<ProjectOrderInput>> {
  const principal = await requirePrincipal();
  try {
    return { success: true, data: await getOrderForProject(principal, String(orderName)) };
  } catch (error) {
    return failure(error, 'reading a sales order');
  }
}

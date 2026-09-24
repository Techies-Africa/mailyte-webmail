import type { QueryClient } from '@tanstack/react-query';
import { bulkMessageAction, type ApiCapabilities, type ApiResult, type BulkRequest } from '@/lib/webmail/client';
import { qk } from './keys';

/**
 * Sending one action for many messages in one request, when the server can
 * take it that way.
 *
 * The answer is turned back into one result per message, in the same shape a
 * per-message request gives, so the action queue settles a bulk action
 * exactly as it settles fifty single ones -- the 404-means-already-gone rule
 * included.
 */

export type BulkAnswer =
  | { kind: 'results'; perId: Map<string, ApiResult<unknown>> }
  /** The server has no bulk endpoint after all: send one by one instead. */
  | { kind: 'unsupported' }
  /** Nothing in the request was attempted; every message gets this result. */
  | { kind: 'failed'; result: ApiResult<unknown> };

/** Most messages one bulk request carries. */
export const BULK_CHUNK = 200;

/** What a per-message error code means, as the HTTP status a single request would have answered. */
function statusFor(code: string | null | undefined): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'not_in_trash':
      return 409;
    case 'mail_server_unavailable':
      return 502;
    default:
      return 400;
  }
}

/** Whether this server has said it takes bulk actions. */
export function bulkAvailable(queryClient: QueryClient): boolean {
  return queryClient.getQueryData<ApiCapabilities>(qk.capabilities)?.capabilities?.bulk_actions === true;
}

/** A sender for `commitOp` that sends `action` for a batch of ids in one request. */
export function bulkSender(
  request: Omit<BulkRequest, 'ids'>,
  onUnauthorized: () => void,
): (ids: string[]) => Promise<BulkAnswer> {
  return async (ids) => {
    const answer = await bulkMessageAction({ ...request, ids }, onUnauthorized);
    if (!answer.success) {
      // No such route on this server (or it refuses the method): fall back.
      if (answer.status === 404 || answer.status === 405 || answer.status === 501) return { kind: 'unsupported' };
      return { kind: 'failed', result: answer };
    }
    const perId = new Map<string, ApiResult<unknown>>();
    for (const item of answer.data?.results ?? []) {
      perId.set(
        item.id,
        item.ok
          ? { success: true, data: { id: item.new_id ?? null } }
          : {
              success: false,
              message: item.message || item.error_code || 'The mail server refused this message',
              status: statusFor(item.error_code),
            },
      );
    }
    return { kind: 'results', perId };
  };
}

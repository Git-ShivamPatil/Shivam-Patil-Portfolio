import { sendPushToOwner } from "./vapid";

/**
 * Domain-shaped notification helpers.
 *
 * Callers should treat these as best-effort side effects — always `.catch()`
 * them rather than awaiting into the critical path, so a push-service outage
 * can never fail the user action that triggered it.
 */

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function notifyOwnerOfChatMessage(input: {
  conversationId: string;
  body: string;
  name?: string;
}): Promise<void> {
  await sendPushToOwner({
    title: input.name ? `New chat from ${input.name}` : "New chat message",
    body: truncate(input.body),
    url: `/admin/chat?c=${input.conversationId}`,
    // Same tag per conversation, so a burst of messages collapses into one
    // notification instead of stacking a dozen.
    tag: `chat-${input.conversationId}`,
  });
}

export async function notifyOwnerOfBooking(input: {
  reference: string;
  name: string;
  offering: string;
  amount: string;
}): Promise<void> {
  await sendPushToOwner({
    title: `Paid booking · ${input.amount}`,
    body: `${input.name} booked ${input.offering} (${input.reference})`,
    url: "/admin/bookings",
    tag: `booking-${input.reference}`,
  });
}

import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { formatMoney } from "../../../lib/money";

export const metadata: Metadata = {
  title: "Admin · Bookings — Shivam Patil",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  CONFIRMED: "bg-lime-200 text-lime-950",
  PENDING_PAYMENT: "bg-amber-100 text-amber-900",
  CANCELLED: "bg-neutral-200 text-neutral-700",
  REFUNDED: "bg-rose-100 text-rose-900",
};

export default async function AdminBookingsPage() {
  await requireAdmin("/admin/bookings");

  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { offering: true, invoice: true, payments: true },
  });

  // Revenue counts only what actually settled — a PENDING_PAYMENT row is a
  // lead, not money.
  const revenueByCurrency = new Map<string, number>();
  for (const booking of bookings) {
    for (const payment of booking.payments) {
      if (payment.status !== "SUCCEEDED") continue;
      revenueByCurrency.set(
        payment.currency,
        (revenueByCurrency.get(payment.currency) ?? 0) + payment.amountMinor,
      );
    }
  }

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Bookings</h1>
        <p className="text-app-muted mt-2 text-sm">
          {bookings.length} booking{bookings.length === 1 ? "" : "s"}
          {revenueByCurrency.size > 0 && (
            <>
              {" · settled: "}
              {[...revenueByCurrency.entries()]
                .map(([currency, minor]) => formatMoney(minor, currency))
                .join(" + ")}
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {bookings.map((booking) => {
          const payment = booking.payments.at(-1);
          return (
            <article key={booking.id} className="border-app-line rounded-2xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-app-fg font-semibold">
                    {booking.name}{" "}
                    <span className="text-app-muted font-normal">— {booking.email}</span>
                  </p>
                  <p className="text-app-muted mt-0.5 text-xs">
                    {booking.reference} · {booking.offering.name} ·{" "}
                    {booking.createdAt.toLocaleString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {booking.referralRef ? ` · ref: ${booking.referralRef}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wide uppercase ${
                      STATUS_TONE[booking.status] ?? "bg-neutral-200 text-neutral-700"
                    }`}
                  >
                    {booking.status.replace(/_/g, " ")}
                  </span>
                  <span className="text-app-fg font-mono text-sm">
                    {formatMoney(booking.offering.priceMinor, booking.offering.currency)}
                  </span>
                </div>
              </div>

              {booking.notes && (
                <p className="text-app-fg mt-3 text-sm whitespace-pre-wrap">{booking.notes}</p>
              )}

              <p className="text-app-muted mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {payment && (
                  <span>
                    {payment.provider} · {payment.status.toLowerCase()} ·{" "}
                    <code className="font-mono">{payment.providerOrderId}</code>
                  </span>
                )}
                {booking.invoice && (
                  <Link
                    href={`/invoice/${booking.invoice.accessToken}`}
                    className="text-app-fg underline"
                  >
                    Invoice {booking.invoice.number}
                  </Link>
                )}
              </p>
            </article>
          );
        })}

        {bookings.length === 0 && (
          <p className="text-app-muted border-app-line rounded-2xl border py-10 text-center">
            No bookings yet.
          </p>
        )}
      </div>
    </div>
  );
}

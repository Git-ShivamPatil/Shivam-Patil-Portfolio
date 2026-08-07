import type { PaymentProvider } from "../generated/prisma/enums";
import type { PaymentAdapter } from "./types";
import { stripeAdapter } from "./stripe";
import { razorpayAdapter } from "./razorpay";

export * from "./types";

const adapters: Record<PaymentProvider, PaymentAdapter> = {
  STRIPE: stripeAdapter,
  RAZORPAY: razorpayAdapter,
};

export function getAdapter(provider: PaymentProvider): PaymentAdapter {
  return adapters[provider];
}

/** Providers whose secrets are actually present in this environment. */
export function availableProviders(): PaymentProvider[] {
  return (Object.keys(adapters) as PaymentProvider[]).filter((name) =>
    adapters[name].isConfigured(),
  );
}

/**
 * Pick a provider for a currency when the client didn't specify one.
 *
 * INR goes to Razorpay when available — domestic Indian rails are cheaper and
 * support UPI, which is what most visitors paying in INR will reach for.
 * Everything else prefers Stripe. Either way we fall back to whatever is
 * configured rather than failing.
 */
export function defaultProviderFor(currency: string): PaymentProvider | null {
  const available = availableProviders();
  if (available.length === 0) return null;

  const preferred: PaymentProvider = currency.toUpperCase() === "INR" ? "RAZORPAY" : "STRIPE";
  return available.includes(preferred) ? preferred : available[0];
}

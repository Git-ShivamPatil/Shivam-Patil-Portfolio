import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "../../../lib/prisma";
import { formatMoney } from "../../../lib/money";
import { PrintButton } from "../../../components/booking/print-button";
import "../invoice.css";

export const metadata: Metadata = {
  title: "Invoice — Shivam Patil",
  // Invoices carry a customer's name and email; they must never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

interface BillTo {
  name: string;
  email: string;
  company: string | null;
}
interface LineItem {
  description: string;
  durationMin: number;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
}

export default async function InvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Authorization is the token itself: 24 random bytes in the URL, which is
  // why the route is keyed on accessToken rather than the invoice id.
  const invoice = await prisma.invoice
    .findUnique({
      where: { accessToken: token },
      include: { booking: { include: { offering: true } } },
    })
    .catch(() => null);

  if (!invoice) notFound();

  const billTo = invoice.billTo as unknown as BillTo;
  const lineItems = invoice.lineItems as unknown as LineItem[];
  const total = invoice.amountMinor + invoice.taxMinor;

  return (
    <section className="invoice-page shell">
      <header className="invoice-head">
        <div>
          <p className="eyebrow">Invoice</p>
          <h1>{invoice.number}</h1>
        </div>
        <PrintButton />
      </header>

      <div className="invoice-meta">
        <div>
          <p className="invoice-label">From</p>
          <p>
            <strong>Shivam Patil</strong>
            <br />
            Mumbai, India
            <br />
            shivampatilinfo@gmail.com
          </p>
        </div>
        <div>
          <p className="invoice-label">Billed to</p>
          <p>
            <strong>{billTo.name}</strong>
            <br />
            {billTo.company ? (
              <>
                {billTo.company}
                <br />
              </>
            ) : null}
            {billTo.email}
          </p>
        </div>
        <div>
          <p className="invoice-label">Issued</p>
          <p>{invoice.issuedAt.toUTCString().replace("GMT", "UTC")}</p>
          <p className="invoice-label" style={{ marginTop: 14 }}>
            Reference
          </p>
          <p>{invoice.booking.reference}</p>
        </div>
      </div>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item, index) => (
            <tr key={index}>
              <td>
                {item.description}
                {item.durationMin ? <small> · {item.durationMin} min</small> : null}
              </td>
              <td>{item.quantity}</td>
              <td>{formatMoney(item.unitAmountMinor, invoice.currency)}</td>
              <td>{formatMoney(item.amountMinor, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Subtotal</td>
            <td>{formatMoney(invoice.amountMinor, invoice.currency)}</td>
          </tr>
          {invoice.taxMinor > 0 && (
            <tr>
              <td colSpan={3}>Tax</td>
              <td>{formatMoney(invoice.taxMinor, invoice.currency)}</td>
            </tr>
          )}
          <tr className="invoice-total">
            <td colSpan={3}>Total paid</td>
            <td>{formatMoney(total, invoice.currency)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="invoice-footnote">
        Paid in full. This invoice was generated automatically when the payment provider confirmed
        the transaction.
      </p>
    </section>
  );
}

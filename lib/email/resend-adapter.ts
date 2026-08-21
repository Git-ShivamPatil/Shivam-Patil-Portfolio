import { Resend } from "resend";
import type { MailAdapter, MailMessage } from "./types";

/**
 * Resend, behind the adapter interface.
 *
 * Kept rather than deleted when SendGrid was added. It works — mail sends and
 * is opened — and the only thing wrong with it here is that this domain's DNS
 * cannot satisfy its verification requirements (§56i). On a domain whose DNS
 * is not on Wix it remains the better API, so removing it would throw away a
 * working option to solve a problem that is not Resend's fault.
 */
export const resendAdapter: MailAdapter = {
  name: "RESEND",

  isConfigured: () => Boolean(process.env.RESEND_API_KEY),

  async send(message: MailMessage, from: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");

    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    });

    // The SDK resolves with `{ data, error }` rather than rejecting, so a
    // failed send looks exactly like a successful one to `await` alone. This
    // is the line that turns it back into something a caller can notice.
    if (error) throw new Error(`Resend refused the message: ${error.message}`);
  },
};

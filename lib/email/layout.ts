// Hand-written HTML instead of a component library: email clients don't
// support CSS variables (or most modern CSS), so every color below is a
// literal hex matching the site's ink/paper/lime palette rather than the
// `var(--x)` tokens used elsewhere. A single simple centered-card layout is
// all two transactional emails need — not enough surface area to justify a
// templating dependency (the current `react-email` unified package pulls in
// ~80MB of unrelated runtime code per serverless function; its predecessor,
// `@react-email/components`, is marked deprecated on npm).
export function emailLayout({
  previewText,
  bodyHtml,
}: {
  previewText: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shivam Patil</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#f4f3ee;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none;font-size:1px;color:#f4f3ee;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${previewText}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:31px;height:31px;border-radius:50%;background:#111110;text-align:center;vertical-align:middle;font:600 10px Arial,sans-serif;color:#d8fe67;">SP</td>
                    <td style="padding-left:10px;font:800 14px Arial,sans-serif;color:#111110;">Shivam Patil</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #d6d4ca;border-radius:16px;padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;text-align:center;font:400 11px Arial,sans-serif;color:#6d6c66;">
                shivamsfolio.com
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border-radius:999px;background:#111110;">
        <a href="${href}" style="display:inline-block;padding:12px 22px;font:700 13px Arial,sans-serif;color:#d8fe67;text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;
}

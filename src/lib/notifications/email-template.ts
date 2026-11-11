// Branded transactional email layout (cream background, deep maroon text, gold
// accents). Pure functions: no I/O, safe to unit-test.

export interface EmailContent {
  subject: string;
  /** Short text shown by mail clients next to the subject. */
  preheader?: string;
  heading: string;
  /** Opening paragraph(s). */
  intro: string[];
  /** Label/value pairs shown as a details table (empty values are skipped). */
  rows?: [label: string, value: string | null | undefined][];
  /** Closing paragraph(s) (next steps). */
  outro?: string[];
  cta?: { label: string; url: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const COLORS = { cream: "#FBF6EC", card: "#FFFDF8", maroon: "#5C1A2B", gold: "#C9A227", goldSoft: "#F3E6BF", muted: "#7A5A60" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function renderEmail(content: EmailContent, siteUrl: string): RenderedEmail {
  const rows = (content.rows ?? []).filter((r): r is [string, string] => typeof r[1] === "string" && r[1].trim() !== "");
  const cta = content.cta ? { label: content.cta.label, url: safeUrl(content.cta.url) } : null;
  const logo = safeUrl(`${siteUrl}/images/swaraanjanam-logo.jpeg`);
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${COLORS.maroon};">${escapeHtml(t)}</p>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.cream};font-family:Georgia,'Times New Roman',serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader ?? content.heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORS.card};border:1px solid ${COLORS.goldSoft};border-radius:16px;overflow:hidden;">
<tr><td align="center" style="padding:28px 24px 12px;border-bottom:3px solid ${COLORS.gold};">
${logo ? `<img src="${escapeHtml(logo)}" width="72" height="72" alt="Swaraanjanam" style="display:block;border-radius:50%;margin:0 auto 10px;">` : ""}
<div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:${COLORS.gold};">Swaraanjanam Carnatic Music Academy</div>
</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${COLORS.maroon};font-weight:normal;">${escapeHtml(content.heading)}</h1>
${content.intro.map(p).join("\n")}
${
  rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse;">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 10px;border-bottom:1px solid ${COLORS.goldSoft};font-size:13px;color:${COLORS.muted};width:40%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:8px 10px;border-bottom:1px solid ${COLORS.goldSoft};font-size:14px;color:${COLORS.maroon};vertical-align:top;">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
${(content.outro ?? []).map(p).join("\n")}
${
  cta?.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="background:${COLORS.maroon};border-radius:999px;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 26px;font-size:15px;color:${COLORS.cream};text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr></table>`
    : ""
}
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid ${COLORS.goldSoft};font-size:12px;line-height:1.6;color:${COLORS.muted};text-align:center;">
Swaraanjanam Carnatic Music Academy<br>
You are receiving this email about your account at <a href="${escapeHtml(siteUrl)}" style="color:${COLORS.maroon};">${escapeHtml(siteUrl.replace(/^https?:\/\//, ""))}</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    content.heading,
    "",
    ...content.intro,
    ...(rows.length ? ["", ...rows.map(([l, v]) => `${l}: ${v}`)] : []),
    ...(content.outro?.length ? ["", ...content.outro] : []),
    ...(cta?.url ? ["", `${cta.label}: ${cta.url}`] : []),
    "",
    "— Swaraanjanam Carnatic Music Academy",
  ].join("\n");

  return { subject: content.subject, html, text };
}

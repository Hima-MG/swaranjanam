// Notifications: email template, link safety, idempotency ids, FAQ content (no Firestore).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { renderEmail, escapeHtml } = await import("@/lib/notifications/email-template");
const { safeNotificationLink, NOTIFICATION_TYPES } = await import("@/lib/notifications/types");
const { notificationId } = await import("@/lib/notifications/ids");
const { faqItems } = await import("@/data/faq");

describe("email template", () => {
  const email = renderEmail(
    {
      subject: "Your Swaraanjanam Registration is Complete",
      heading: "Namaskaram <b>Asha</b>",
      intro: ["Thank you & welcome."],
      rows: [["Course", "Swara Foundation"], ["Teacher", null], ["Payment status", "Paid (verified)"]],
      outro: ["Next steps: the academy will assign you to a batch."],
      cta: { label: "Open your dashboard", url: "https://example.test/dashboard" },
    },
    "https://example.test",
  );
  test("brand: cream background, maroon text, gold accent, logo and footer", () => {
    assert.match(email.html, /#FBF6EC/);
    assert.match(email.html, /#5C1A2B/);
    assert.match(email.html, /#C9A227/);
    assert.match(email.html, /https:\/\/example\.test\/images\/swaraanjanam-logo\.jpeg/);
    assert.match(email.html, /Swaraanjanam Carnatic Music Academy<br>/);
    assert.match(email.html, /max-width:560px/);
  });
  test("content is escaped; empty rows skipped; plain-text part included", () => {
    assert.ok(email.html.includes("Namaskaram &lt;b&gt;Asha&lt;/b&gt;"));
    assert.ok(!email.html.includes("<b>Asha</b>"));
    assert.ok(!email.html.includes(">Teacher<"));
    assert.match(email.text, /Course: Swara Foundation/);
    assert.match(email.text, /Open your dashboard: https:\/\/example\.test\/dashboard/);
    assert.equal(email.subject, "Your Swaraanjanam Registration is Complete");
  });
  test("non-http CTA links are dropped", () => {
    const bad = renderEmail({ subject: "s", heading: "h", intro: [], cta: { label: "x", url: "javascript:alert(1)" } }, "https://example.test");
    assert.ok(!bad.html.includes("javascript:"));
  });
  test("escapeHtml", () => assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;"));
});

describe("notification links and ids", () => {
  test("only same-site paths are kept", () => {
    assert.equal(safeNotificationLink("/dashboard/billing"), "/dashboard/billing");
    assert.equal(safeNotificationLink("/receipts/rzp_pay_1"), "/receipts/rzp_pay_1");
    assert.equal(safeNotificationLink("https://evil.test"), "/dashboard");
    assert.equal(safeNotificationLink("//evil.test"), "/dashboard");
    assert.equal(safeNotificationLink(null), "/dashboard");
  });
  test("ids are deterministic per event key (idempotency) and distinct across events", () => {
    assert.equal(notificationId("payment:rzp_pay_1"), notificationId("payment:rzp_pay_1"));
    assert.notEqual(notificationId("payment:rzp_pay_1"), notificationId("payment:rzp_pay_2"));
    assert.match(notificationId("x"), /^n_[a-f0-9]{40}$/);
  });
  test("every required event type exists", () => {
    for (const t of ["registration_completed", "payment_success", "payment_failed", "invoice_generated", "payment_due", "payment_overdue", "batch_assigned", "individual_scheduled", "class_rescheduled", "class_cancelled", "recording_available"]) {
      assert.ok(NOTIFICATION_TYPES.includes(t), t);
    }
  });
});

describe("FAQ", () => {
  const items = faqItems(null);
  const all = items.map((i) => `${i.question} ${i.answer}`).join("\n");
  test("no book price, book recommendation and ordering kept", () => {
    assert.ok(!/₹500|\$50/.test(all));
    const book = items.find((i) => i.question === "Do I need any book or app?");
    assert.match(book.answer, /Sangeetha Sampoorna – Beginners Level by Dr\. Anuradha Mahesh/);
    assert.match(book.answer, /order on WhatsApp 80757 56318/);
  });
  test("no fixed batch timing; schedules confirmed after registration", () => {
    assert.ok(!/Saturday|7–8 PM|timings are fixed/i.test(all));
    const timing = items.find((i) => i.question === "What are the class days and timings?");
    assert.equal(
      timing.answer,
      "Class schedules are confirmed after registration. The academy assigns students to suitable batches or confirms individual class timings based on teacher availability and student preferences. Students receive their confirmed schedule through their dashboard and email.",
    );
  });
});

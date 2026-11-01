# Batches and monthly class billing — handover

Status legend: **Implemented** (code exists) · **Tested** (automated tests ran and passed) ·
**Browser-checked** (clicked through signed in, against local emulators) ·
**Needs configuration** (settings/credentials) · **Pending** (needs an academy decision or a manual check).

Nothing in this work was committed, pushed or deployed. No production data was read or written.

## Billing model (confirmed rules)

| Rule | Detail |
|---|---|
| Start | Website billing starts with **November 2026**. Fees up to October 2026 stay with the previous payment method; classes before 1 Nov 2026 (IST) are never charged by the website. |
| Old dues gate | A student enters website billing (added to a batch, or given an individual account) only after an administrator records **"old dues cleared"** or **"no dues before November 2026"**. The record keeps who verified it and when. No amounts are entered or invented. |
| Batch classes | ₹400 per class per student. **Attended** and **absent** are charged. **Academy-cancelled**, **rescheduled** and **unknown attendance** are not. A charged class cannot be changed to a non-billable outcome (use a credit note). |
| Monthly invoice | One invoice per student per calendar month (`{accountId}_{YYYY-MM}`, created once — retries and concurrent runs cannot duplicate it). It covers every charged class of that month not yet invoiced (and any earlier month's leftovers). Example: 8 classes = ₹3,200 − ₹400 advance = **₹2,800**. |
| Advance | ₹400, once per batch account, **non-refundable** (also when a student stops early). Deducted only after it is **verified** (paid), on the first invoice generated after that; an unused part is carried to later invoices. Every receipt/application/reversal is written to `advanceLedger`. An unpaid advance is never deducted. The only way to undo a recorded advance payment is **"Reverse (payment error)"** with a required mistake reason (duplicate payment, wrong student, wrong amount, money not received) — the advance then becomes owed again; it is not a refund path. |
| Due date / grace | Due on the last day of the month; **payment deadline = 7th of the next month, 23:59:59.999 IST**. 00:00 IST on the 8th is overdue. (Tested at the exact millisecond boundary.) |
| Suspension | Unpaid after the deadline → batch access paused (Meet links hidden from the page payload, course pages blocked, banner shown). Records are kept. Restored automatically when no invoice is past its deadline with a balance (after a verified payment, credit note, or re-evaluation). |
| Individual sessions | ₹750 each, paid per session (`sessionCharges/sc_{classId}`), never invoiced monthly. Student cancels **≥ 24 h** before start → no charge; **< 24 h** → still payable; academy cancels or reschedules → no charge. Decided on the server with the server clock. |
| Rates | Versioned and effective from a month (`settings/classBilling.rateVersions`). A new version must start in a **future** month; every charge stores its rate and version id; issued invoices are never recalculated. v1 (Nov 2026) = ₹400 / ₹750 / ₹400. |
| Legacy packages | **Read-only** (`src/lib/lms/legacy-packages.ts`). Blocked on the server: creating, activating or adjusting a package, recording a new payment against one, and scheduling a new class that uses package credits. Still possible: viewing, cancelling a package, and correcting the status of an already-recorded payment. Records are never deleted. A class linked to a package can never also be billed per class. |
| Enrolment fee | Enrolling a student **never** copies the catalogue's legacy `course.price` into `agreedFee` (it is template data, not an approved fee). `agreedFee` starts empty; a teacher can set one explicitly, with a reason, if ever needed. No debt is created or inferred. |

The four-class cycle has been removed everywhere (types, server logic, UI, tests). Nothing in the code still groups classes in fours.

## Where things are

| Area | Files |
|---|---|
| Pure rules (periods, deadlines, rates, policies, 24 h rule, invoice maths) | `src/lib/lms/class-billing.ts` |
| Server billing (charges, monthly invoices, advance ledger, suspension, session charges, old dues, scheduled job) | `src/lib/lms/server/class-billing.ts` |
| Batches (membership, old-dues gate on add) | `src/lib/lms/server/batches.ts`, `src/app/(account)/teacher/batch-actions.ts` |
| Scheduling, cancellation, attendance | `src/app/(account)/teacher/class-actions.ts` |
| Admin billing actions (run billing, advance, notes, rates, policy, old dues) | `src/app/(account)/teacher/class-billing-actions.ts` |
| Access suspension | `src/lib/lms/server/access.ts`, `src/lib/lms/server/classes.ts`, `getOwnBatches` |
| Payments (manual + Razorpay test mode) | `src/app/(account)/teacher/payment-actions.ts`, `src/lib/lms/server/gateway.ts`, `src/lib/payments/*`, `/api/payments/razorpay/webhook` |
| Scheduled job | `src/app/api/cron/billing/route.ts`, `vercel.json` |
| Teacher screens | `/teacher/billing`, `/teacher/billing/[accountId]`, `/teacher/billing/settings`, `/teacher/batches/[batchId]`, `/teacher/students/[id]` (Old dues) |
| Student screens | `/dashboard` (batch, fee banner, suspension), `/dashboard/billing` (advance, invoices, sessions) |

New Firestore collections (Admin SDK only; the existing deny-all rule covers them):
`advanceLedger`, `sessionCharges`, `legacyDues` (plus `batches`, `billingAccounts`, `billableClasses`, `invoices`,
`invoiceAdjustments`, `gatewayOrders`, `gatewayEvents` from the earlier batch work). **No migration is required**; nothing
existing is rewritten.

## Configuration still needed

1. **Scheduled billing job** — set `CRON_SECRET` (a long random string) in Vercel. `vercel.json` runs
   `GET /api/cron/billing` daily at 19:00 UTC (00:30 IST); Vercel sends `Authorization: Bearer $CRON_SECRET`.
   Without the variable the endpoint answers 503 and does nothing. The job is idempotent: it generates each completed
   month's invoices (create-once ids) and re-evaluates suspensions. "Run billing now" on `/teacher/billing` runs the same job.
   Note: Vercel Hobby plans allow daily crons only, which is what this needs.
2. **Razorpay (Test Mode only)** — `RAZORPAY_KEY_ID` (`rzp_test_…`; live keys are refused), `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_WEBHOOK_SECRET`. In the Razorpay test dashboard enable auto-capture and add the webhook
   `https://<domain>/api/payments/razorpay/webhook` (events `payment.captured`, `order.paid`).
   A payment is marked paid only after the server verifies the checkout signature *and* looks the payment
   up from Razorpay (or a signed webhook arrives) — never from the browser alone.
   **Test Mode is isolated from production (fail-closed, `src/lib/payments/environment.ts`).** Test Mode payments are
   accepted only when the server's Firebase project (`FIREBASE_ADMIN_PROJECT_ID`) is an emulator project (`demo-…`) or
   is listed in `RAZORPAY_TEST_FIREBASE_PROJECTS` (non-production projects only — **never list production**). Otherwise
   order creation, checkout confirmation and the webhook (503) all refuse, so a Test Mode payment can never clear a
   production invoice, mark a session paid, issue a receipt or lift a suspension. Orders and payments are stamped
   `mode: "test"`; a payment cannot settle an order of another mode. `/teacher/billing/settings` shows whether online
   payments are enabled and why not. Consequence: `npm run dev` against the production Firebase project has online
   payments **disabled** (intended); use `npm run dev:emulator` or a separate staging project to test payments.
   Live Mode is a separate, future change and needs explicit approval.
3. **Messages** — there is **no email/SMS/WhatsApp provider** in the project. No messages are sent. Students see
   in-app reminders instead (dashboard fee banner with amount and deadline; "Access paused" notice). Adding a
   provider is a separate decision.
4. **Old-dues verification** must be recorded for every existing student before they are added to a batch or given an
   individual account (Teacher → Students → student → "Old dues (before November 2026)").
5. **Firestore rules must be deployed** (production configuration change — needs approval): `firestore.rules` now
   refuses direct browser reads of a course and its lessons while that student's batch or individual billing account
   is suspended (`suspension.active`), matching the server check. The app itself reads Firestore only on the server,
   so no authorised user is affected. Until deployed, the production rules still allow a suspended but enrolled student
   to read a lesson document by id through the Firebase browser SDK. Command, after approval:
   `firebase deploy --only firestore:rules --project <production project>`.
6. **Course catalogue reconciliation — awaiting the academy.** The 10 published courses still carry migrated template
   content ("Swaraanjanam Faculty", no assigned teachers, tags such as "Bestseller"/"Limited Seats", durations), and the
   7 fee plans (four-class packages) are not linked to any course, so every course shows "Fees on request". Nothing was
   renamed, linked or priced. The academy must confirm the course list, teachers and how fees are presented under the
   monthly ₹400 / per-session ₹750 model.

## Testing

Automated (see the latest run in the final report):

- `npm test` — unit tests (deadline/grace boundary, 24-hour boundary, rate versions, invoice maths, carry-forward,
  old dues, Razorpay signatures, Test Mode environment, read-only packages, non-refundable advance, rules).
- `npm run test:emulator` — Firestore-emulator integration tests (monthly invoice + advance = ₹2,800, no duplicates
  under retry/concurrency, unpaid advance never deducted, suspension and restoration after verified payment, session
  charges, gateway idempotency, **Test Mode refused for a production project on every path incl. the signed webhook**,
  rules deny browser access and **block lesson reads while suspended**).
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`.

On this Windows machine the emulator needs `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<a writable temp folder>`.

### Signed-in local testing with emulators (never production)

```
npm run emulators        # Auth :9099 + Firestore :8080, project demo-swaranjanam
npm run seed:emulator    # test accounts + data (idempotent)
npm run dev:emulator     # http://localhost:3100 — Firebase settings forced to the emulators
```

`dev:emulator` overrides every Firebase variable (demo project, throwaway Admin key) and refuses non-`demo-` projects;
the production Admin key is never loaded. Test accounts are listed at the top of `scripts/seed-emulator.mjs`
(teacher, Asha, Bala — old dues not verified, Chitra — ₹2,800 invoice, Devi — suspended, Esha — individual sessions).

### Manual checklist (test accounts only)

Teacher/administrator
- [ ] Add a student whose old dues are not verified → refused; verify old dues → verifier and time shown; add → ₹400 advance awaiting.
- [ ] Schedule a batch class; edit the batch Meet link → students' Join link changes.
- [ ] Record attended / absent / unknown; cancel as academy / student / rescheduled; check charges on the account page.
- [ ] Individual account: schedule a session, cancel as student > 24 h before (no charge) and < 24 h before (payment due).
- [ ] Record a manual payment for an advance, invoice and session; check receipts; check suspended access is restored.
- [ ] Add a rate version for a future month; confirm issued invoices keep their lines and totals.
- [ ] After setting `CRON_SECRET` in a preview deployment, call the cron URL with the bearer header and check the result.

Student
- [ ] Dashboard: batch, schedule, Join link (only 15 minutes before), attendance on past classes.
- [ ] Billing: advance amount and status, monthly invoice lines, deadline, individual sessions and their status.
- [ ] Suspended student: no Join links, course pages blocked, overdue banner.
- [ ] With Razorpay **test** keys only: pay an advance/invoice/session with a Razorpay test card; confirm it shows as paid only after verification.

## Decisions still needed from the academy

1. Batch class cancelled **by the student**: billable? (Default: not billed; setting on `/teacher/billing/settings`.)
2. Must the ₹400 advance be verified before a student's first batch class is scheduled? (Default: no; setting available.)
3. ~~Is an unused advance refunded when a student leaves?~~ **Decided: non-refundable.**
4. Restoration is automatic once no invoice is past its deadline with a balance — should any other condition apply?
5. An individual session that was already **paid** and then cancelled/rescheduled is flagged "needs review" — transfer or refund?
6. November 2026 rates are fixed by v1 (the confirmed defaults); the earliest new rate version is December 2026.

## Media delivery (Cloudinary) — assessment

| Asset | Where | Access today | Should be |
|---|---|---|---|
| Course thumbnails | `<folder>/courses/<id>/thumbnails/` | Public delivery URL | **Public** (shown on the public catalogue) |
| Lesson resources (video, audio, PDF, image) | `<folder>/courses/<id>/resources/` | Public delivery URL with a random UUID public id; the app shows it only to enrolled, non-suspended students and teachers | **Protected** |
| Student practice recordings | `<folder>/submissions/<studentId>/` | Public delivery URL with a random UUID; shown only to the student and teachers | **Protected** (personal data) |
| YouTube / external embeds | lesson resources | Governed by the provider's own settings | Unlisted/private on the provider |

Production currently has **no** Cloudinary assets in use (0 lesson resources, 0 course images, 0 submissions), so
nothing would break today. Signed/authenticated delivery was **not implemented**, deliberately:

- Cloudinary `authenticated` delivery with signed URLs works on every plan, but those signatures **do not expire**:
  anyone who once received a URL can keep using and sharing it — the same exposure as today's unguessable UUID URLs.
  It would not stop access after a suspension or revocation.
- Real, time-limited protection needs Cloudinary **token-based authentication** (a paid add-on that must be enabled
  on the account) or streaming media through an authenticated server route (Vercel bandwidth/time limits, video seeking).
- The upload limits in `src/lib/media/config.ts` are set to free-plan limits, which suggests the account is on the free
  plan. Validating the plan or testing a protected upload would require calls/uploads against the **production**
  Cloudinary account, which was not authorised. Note also that free Cloudinary accounts block **PDF delivery** unless
  "Allow delivery of PDF and ZIP files" is enabled in the account's security settings — check this before uploading PDFs.

Required decision before implementing: which option the academy accepts (token authentication add-on, or a server
proxy), plus a test Cloudinary environment. Existing public assets would need re-uploading as `authenticated`
(a migration — none exist yet in production).

## Not built / out of scope

- Email/SMS/WhatsApp delivery (no provider).
- Refund functionality of any kind (the advance is non-refundable; payment mistakes are corrected manually; Razorpay
  refunds, if ever needed for a mistake, are done in the Razorpay dashboard).
- Conversion of legacy packages, and any production data migration.
- One real Razorpay **Test Mode** order (₹400 advance) was created locally against the emulator and Checkout was closed
  without paying. A completed test payment, invoice/session payments and real webhook delivery are still to be tested
  (on the emulator or a listed staging project — never production).

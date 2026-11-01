// Unit tests for Razorpay signature verification (src/lib/payments/razorpay-signature.ts)
// and a static check that every new Server Action verifies the right role first.
// Pure/mocked: no network, no Razorpay account, no real money.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { isTestKeyId, verifyCheckoutSignature, verifyWebhookSignature } from "../../src/lib/payments/razorpay-signature.ts";

const SECRET = "test_secret_value";
const sign = (payload, secret = SECRET) => createHmac("sha256", secret).update(payload).digest("hex");

describe("checkout signature", () => {
  test("valid signature is accepted", () => {
    assert.equal(verifyCheckoutSignature("order_A1", "pay_B2", sign("order_A1|pay_B2"), SECRET), true);
  });
  test("tampered order, payment, signature or wrong secret are rejected", () => {
    const good = sign("order_A1|pay_B2");
    assert.equal(verifyCheckoutSignature("order_A9", "pay_B2", good, SECRET), false);
    assert.equal(verifyCheckoutSignature("order_A1", "pay_B9", good, SECRET), false);
    assert.equal(verifyCheckoutSignature("order_A1", "pay_B2", good.replace(/.$/, (c) => (c === "0" ? "1" : "0")), SECRET), false);
    assert.equal(verifyCheckoutSignature("order_A1", "pay_B2", good, "other_secret"), false);
  });
  test("malformed input is rejected without throwing", () => {
    for (const bad of [undefined, null, 42, "", "not-hex", "a".repeat(63)]) assert.equal(verifyCheckoutSignature("order_A1", "pay_B2", bad, SECRET), false);
    assert.equal(verifyCheckoutSignature("", "pay_B2", sign("|pay_B2"), SECRET), false);
    assert.equal(verifyCheckoutSignature("order_A1", "pay_B2", sign("order_A1|pay_B2", ""), ""), false);
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 40000, currency: "INR", status: "captured" } } } });
  test("signature over the exact raw body is accepted", () => {
    assert.equal(verifyWebhookSignature(body, sign(body), SECRET), true);
  });
  test("any change to the body invalidates it (e.g. an increased amount)", () => {
    assert.equal(verifyWebhookSignature(body.replace("40000", "4000000"), sign(body), SECRET), false);
  });
  test("missing secret or signature is rejected", () => {
    assert.equal(verifyWebhookSignature(body, sign(body), ""), false);
    assert.equal(verifyWebhookSignature(body, null, SECRET), false);
  });
});

describe("test mode only", () => {
  test("only rzp_test_ key ids are accepted", () => {
    assert.equal(isTestKeyId("rzp_test_AbC123"), true);
    for (const bad of ["rzp_live_AbC123", "", null, undefined, "rzp_test_", "rzp_test_ab-c"]) assert.equal(isTestKeyId(bad), false, String(bad));
  });
});

describe("new Server Actions verify the right role before anything else", () => {
  const cases = [
    ["src/app/(account)/teacher/batch-actions.ts", "teacher"],
    ["src/app/(account)/teacher/class-billing-actions.ts", "teacher"],
    ["src/app/(account)/teacher/class-actions.ts", "teacher"],
    ["src/app/(account)/teacher/payment-actions.ts", "teacher"],
    ["src/app/(account)/dashboard/payment-actions.ts", "student"],
  ];
  for (const [file, role] of cases) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const parts = source.split(/^export async function /m).slice(1);
    test(`${file} (${parts.length} actions, ${role})`, () => {
      assert.ok(parts.length > 0);
      for (const part of parts) {
        const name = part.slice(0, part.indexOf("("));
        assert.match(part, new RegExp(`^[^]*?return runAction\\("[A-Za-z]+", async \\(\\) => \\{\\s*const user = await requireActionUser\\("${role}"\\);`), `${name} must call requireActionUser("${role}") first`);
      }
    });
  }
  test("the browser never sends the amount to the payment actions", () => {
    const source = readFileSync(new URL("../../src/app/(account)/dashboard/payment-actions.ts", import.meta.url), "utf8");
    assert.equal(/amount/i.test(source.match(/startOnlinePayment\([^)]*\)/)[0]), false);
  });
});

// Unit tests for the Contact-page enquiry (src/lib/contact-enquiry.ts).
// Pure tests: they check validation and the prefilled links. Whether WhatsApp
// opens on a given device needs a manual browser test.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { emailEnquiryUrl, ENQUIRY_LIMITS, enquiryText, parseEnquiry, whatsappEnquiryUrl } from "../../src/lib/contact-enquiry.ts";

const valid = { name: "  Lakshmi   Menon ", email: "Lakshmi@Example.com ", phone: "+91 98765 43210", course: "Swara Foundation", message: "I am a beginner." };

describe("enquiry validation", () => {
  test("valid input is cleaned", () => {
    const { value, errors } = parseEnquiry(valid);
    assert.deepEqual(errors, {});
    assert.equal(value.name, "Lakshmi Menon");
    assert.equal(value.email, "lakshmi@example.com");
  });
  test("name and email are required", () => {
    const { value, errors } = parseEnquiry({ ...valid, name: " ", email: "" });
    assert.equal(value, null);
    assert.ok(errors.name && errors.email);
  });
  for (const email of ["lakshmi", "lakshmi@", "@example.com", "a b@example.com", "lakshmi@example"]) {
    test(`rejects email ${JSON.stringify(email)}`, () => assert.ok(parseEnquiry({ ...valid, email }).errors.email));
  }
  test("phone and message are optional; a bad phone is rejected", () => {
    assert.deepEqual(parseEnquiry({ ...valid, phone: "", message: "" }).errors, {});
    assert.ok(parseEnquiry({ ...valid, phone: "call me" }).errors.phone);
  });
  test("an over-long message is rejected, not silently cut", () => {
    assert.ok(parseEnquiry({ ...valid, message: "a".repeat(ENQUIRY_LIMITS.message + 1) }).errors.message);
  });
  test("non-string input is treated as empty", () => {
    assert.ok(parseEnquiry({ name: 42, email: null, phone: undefined, course: {}, message: [] }).errors.name);
  });
});

describe("prefilled links", () => {
  const { value } = parseEnquiry(valid);

  test("WhatsApp link uses the configured click-to-chat URL with the text encoded", () => {
    const url = whatsappEnquiryUrl("https://wa.me/918547545175", value);
    assert.ok(url.startsWith("https://wa.me/918547545175?text="));
    const text = decodeURIComponent(new URL(url).searchParams.get("text"));
    assert.equal(text, enquiryText(value));
    assert.match(text, /Name: Lakshmi Menon/);
    assert.match(text, /Interested in: Swara Foundation/);
  });

  test("special characters cannot break out of the text parameter", () => {
    const { value: tricky } = parseEnquiry({ ...valid, message: "A&B=1?#x\nnext line" });
    const url = new URL(whatsappEnquiryUrl("https://wa.me/918547545175", tricky));
    assert.equal([...url.searchParams.keys()].join(","), "text");
    assert.match(url.searchParams.get("text"), /A&B=1\?#x\nnext line/);
  });

  test("'Not sure yet' when no course is chosen; phone omitted when empty", () => {
    const { value: v } = parseEnquiry({ ...valid, course: "", phone: "" });
    const text = enquiryText(v);
    assert.match(text, /Interested in: Not sure yet/);
    assert.equal(text.includes("Phone:"), false);
  });

  test("email fallback is a mailto link with subject and body", () => {
    const url = emailEnquiryUrl("swaraanjanammusicacademy@gmail.com", value);
    assert.ok(url.startsWith("mailto:swaraanjanammusicacademy@gmail.com?subject="));
    assert.match(decodeURIComponent(url), /Enquiry from Lakshmi Menon — Swara Foundation/);
  });
});

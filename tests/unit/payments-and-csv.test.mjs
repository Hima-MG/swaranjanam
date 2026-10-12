// Unit tests for payment input parsing and CSV export escaping.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toCsv } from "../../src/lib/csv.ts";
import { parseAmountMinor, parsePaidAt } from "../../src/lib/lms/payment-input.ts";

describe("parseAmountMinor (paise)", () => {
  for (const [input, expected] of [
    ["2500", 250000],
    ["2,500.50", 250050],
    ["₹ 99.9", 9990],
    ["0.01", 1],
    ["10000000", 1_000_000_000],
  ]) {
    test(`"${input}" → ${expected}`, () => assert.equal(parseAmountMinor(input), expected));
  }
  for (const input of ["0", "-5", "1.234", "abc", "1e5", "100000001", "", null, undefined]) {
    test(`rejects ${JSON.stringify(input)}`, () => assert.equal(parseAmountMinor(input), null));
  }
});

describe("parsePaidAt", () => {
  const now = Date.parse("2026-10-11T10:00:00+05:30");
  test("today", () => assert.equal(parsePaidAt("2026-10-11", now)?.toISOString().slice(0, 10), "2026-10-11"));
  test("future rejected", () => assert.equal(parsePaidAt("2026-10-20", now), null));
  test("impossible date rejected", () => assert.equal(parsePaidAt("2026-02-30", now), null));
  test("wrong format rejected", () => assert.equal(parsePaidAt("11/10/2026", now), null));
  test("before 2000 rejected", () => assert.equal(parsePaidAt("1999-12-31", now), null));
});

describe("toCsv", () => {
  const csv = toCsv(["Name", "Note"], [
    ['=HYPERLINK("x")', "a,b"],
    ["+1", "line1\nline2"],
    ["@SUM(A1)", "-3"],
    ["Normal", '"q"'],
    ["അഞ്ജന", null],
  ]);
  test("starts with a UTF-8 BOM and uses CRLF", () => {
    assert.ok(csv.startsWith("﻿"));
    assert.ok(csv.includes("\r\n"));
  });
  test("neutralises formula injection", () => {
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes("'+1"));
    assert.ok(csv.includes("'@SUM(A1)"));
    assert.ok(csv.includes("'-3"));
  });
  test("quotes commas, quotes and newlines", () => {
    assert.ok(csv.includes('"a,b"'));
    assert.ok(csv.includes('"line1\nline2"'));
    assert.ok(csv.includes('"""q"""'));
  });
  test("keeps Malayalam text and empty cells", () => assert.ok(csv.includes("അഞ്ജന,\r\n")));
});

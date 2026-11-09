// Unit tests for role resolution at sign-in and on every request.
// Pure / static: no Firebase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { resolveRole, ROLE_HOME } from "../../src/lib/auth/constants.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("resolveRole", () => {
  test("profile role = teacher without a custom claim → teacher (the reported bug)", () => {
    assert.equal(resolveRole(undefined, "teacher"), "teacher");
    assert.equal(ROLE_HOME[resolveRole(undefined, "teacher")], "/teacher");
  });

  test("profile role = student → student dashboard", () => {
    assert.equal(resolveRole(undefined, "student"), "student");
    assert.equal(ROLE_HOME[resolveRole(undefined, "student")], "/dashboard");
  });

  test("the custom claim, set only by trusted server code, wins", () => {
    assert.equal(resolveRole("teacher", "student"), "teacher");
    assert.equal(resolveRole("admin", undefined), "teacher");
    assert.equal(resolveRole("student", "teacher"), "student");
  });

  test("missing or invalid role → null (access error), never teacher", () => {
    for (const [claim, profile] of [
      [undefined, undefined],
      [undefined, null],
      [undefined, "Teacher"],
      [undefined, "admin"],
      ["owner", undefined],
      [true, "superuser"],
    ]) {
      assert.equal(resolveRole(claim, profile), null, `${claim} / ${profile}`);
    }
  });
});

describe("session wiring", () => {
  test("every request resolves the role from the claim, else the server-written profile", () => {
    const session = read("src/lib/auth/session.ts");
    assert.match(session, /resolveRole\(claims\.role, undefined\)/);
    assert.match(session, /collection\("users"\)\.doc\(claims\.uid\)\.get\(\)/);
    assert.match(session, /return role \? toSessionUser\(claims, role\) : null;/);
    assert.doesNotMatch(session, /: "student";/, "no silent student default");
  });

  test("sign-in resolves the role after the profile exists and refuses accounts without one", () => {
    const route = read("src/app/api/auth/session/route.ts");
    assert.ok(route.indexOf("ensureUserProfile({") < route.indexOf("resolveSessionRole(decoded)"));
    assert.ok(route.indexOf("resolveSessionRole(decoded)") < route.indexOf("(await cookies()).set("));
    assert.match(route, /NO_ROLE_MESSAGE \}, \{ status: 403 \}/);
  });

  test("first sign-in never overwrites an existing profile's role", () => {
    const profile = read("src/lib/auth/profile.ts");
    assert.match(profile, /if \(snapshot\.exists\) return;/);
  });

  test("clients can never write users/{uid} (so the profile role is trustworthy)", () => {
    assert.match(read("firestore.rules"), /match \/users\/\{uid\} \{[\s\S]*?allow write: if false;/);
  });
});

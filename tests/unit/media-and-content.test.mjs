// Cloudinary upload rules (incl. documents uploaded as "raw"), and the site-wide
// content changes: academy phone number, no book price, no fixed class timings.
// No network: Cloudinary is only asked to SIGN, never called.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "democloud";
process.env.CLOUDINARY_API_KEY = "123";
process.env.CLOUDINARY_API_SECRET = "test-secret";
process.env.CLOUDINARY_UPLOAD_FOLDER = "swaranjanam";

const { attachmentUrl, checkFileForUpload, isDownloadableKind, UPLOAD_RULES } = await import("../../src/lib/media/config.ts");
const { createUploadTicket, MediaValidationError } = await import("../../src/lib/media/cloudinary.ts");
const { siteConfig } = await import("../../src/config/site.ts");

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
function sourceFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? sourceFiles(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}
const SRC = sourceFiles("src");

describe("Cloudinary resource types", () => {
  test("images as image, PDFs as image, audio and video as video, documents as raw", () => {
    assert.equal(UPLOAD_RULES.image.resourceType, "image");
    assert.equal(UPLOAD_RULES.pdf.resourceType, "image");
    assert.equal(UPLOAD_RULES.audio.resourceType, "video");
    assert.equal(UPLOAD_RULES.video.resourceType, "video");
    assert.equal(UPLOAD_RULES.document.resourceType, "raw");
  });

  test("browser pre-check accepts listed formats within the size limit only", () => {
    assert.equal(checkFileForUpload("document", { name: "Week 1 notes.DOCX", size: 2048 }), null);
    assert.equal(checkFileForUpload("audio", { name: "lesson.mp3", size: 2048 }), null);
    assert.equal(checkFileForUpload("video", { name: "lesson.mp4", size: 2048 }), null);
    assert.equal(checkFileForUpload("pdf", { name: "notes.pdf", size: 2048 }), null);
    assert.equal(checkFileForUpload("image", { name: "cover.png", size: 2048 }), null);
    assert.match(checkFileForUpload("document", { name: "virus.exe", size: 10 }), /Unsupported/);
    assert.match(checkFileForUpload("image", { name: "big.jpg", size: 11 * 1024 * 1024 }), /limit is 10/);
    assert.match(checkFileForUpload("pdf", { name: "empty.pdf", size: 0 }), /empty/);
  });

  test("raw document tickets keep the extension, sign allowed formats, and go to the raw endpoint", () => {
    const ticket = createUploadTicket("course1", "document", "resource", "Notes.DOCX");
    assert.equal(ticket.uploadUrl, "https://api.cloudinary.com/v1_1/democloud/raw/upload");
    assert.match(ticket.publicId, /^swaranjanam\/courses\/course1\/resources\/[0-9a-f-]{36}\.docx$/);
    assert.equal(ticket.fields.public_id, ticket.publicId);
    assert.match(ticket.fields.allowed_formats, /\bdocx\b/);
    assert.ok(ticket.fields.signature && !JSON.stringify(ticket).includes("test-secret"), "secret never leaves the server");
    assert.throws(() => createUploadTicket("course1", "document", "resource", "run.exe"), MediaValidationError);
  });

  test("image, video and cover tickets have no extension and use their own endpoints and folders", () => {
    assert.match(createUploadTicket("course1", "video", "resource").uploadUrl, /\/video\/upload$/);
    assert.match(createUploadTicket("course1", "audio", "resource").uploadUrl, /\/video\/upload$/);
    const cover = createUploadTicket("course1", "image", "cover");
    assert.match(cover.publicId, /^swaranjanam\/courses\/course1\/covers\/[0-9a-f-]{36}$/);
    assert.throws(() => createUploadTicket("../x", "image", "cover"), MediaValidationError);
  });

  test("downloads: images and PDFs get fl_attachment; raw documents are delivered unchanged", () => {
    assert.equal(attachmentUrl("https://res.cloudinary.com/d/image/upload/v1/a.pdf"), "https://res.cloudinary.com/d/image/upload/fl_attachment/v1/a.pdf");
    assert.equal(attachmentUrl("https://res.cloudinary.com/d/raw/upload/v1/a.docx"), "https://res.cloudinary.com/d/raw/upload/v1/a.docx");
    assert.equal(isDownloadableKind("document"), true);
    assert.equal(isDownloadableKind("video"), false);
  });

  test("media is stored as Cloudinary metadata, never as base64 in Firestore", () => {
    for (const f of SRC) assert.doesNotMatch(read(f), /readAsDataURL|data:(image|audio|video|application)\/[a-z+.-]+;base64/, f);
  });
});

describe("academy contact number", () => {
  test("shown as 79091 50030 with international call and WhatsApp links", () => {
    assert.equal(siteConfig.contact.phone, "79091 50030");
    assert.equal(siteConfig.contact.whatsapp, "79091 50030");
    assert.equal(siteConfig.contact.phoneHref, "tel:+917909150030");
    assert.equal(siteConfig.contact.whatsappUrl, "https://wa.me/917909150030");
  });
  test("the old number appears nowhere in the source", () => {
    for (const f of SRC) assert.doesNotMatch(read(f), /85475|8547545175/, f);
  });
});

describe("removed public content", () => {
  test("no book price anywhere", () => {
    for (const f of SRC) assert.doesNotMatch(read(f), /₹\s?500 \(India\)|\$50 \(USA|book price/i, f);
  });
  test("no fixed public class timings in marketing copy and FAQ", () => {
    for (const f of ["src/data/content.ts", "src/data/faq.ts", "src/components/home/hero.tsx", "src/components/home/courses-and-fees.tsx", "src/app/(public)/courses/[slug]/page.tsx"]) {
      assert.doesNotMatch(read(f), /any day except Sunday|batch timings fixed|class days and timings|morning batch|evening batch/i, f);
    }
  });
});

describe("homepage section buttons", () => {
  test("the CTA banner has Enrol now → /register, Courses → /#courses and Fees → /#fees", () => {
    const banner = read("src/components/shared/cta-banner.tsx");
    assert.match(banner, /<Link href="\/register">\s*Enrol now/);
    assert.match(banner, /<SectionLink href="\/#courses">Courses<\/SectionLink>/);
    assert.match(banner, /<SectionLink href="\/#fees">Fees<\/SectionLink>/);
  });
  test("the #fees anchor is always rendered, with or without published courses", () => {
    const section = read("src/components/home/courses-and-fees.tsx");
    assert.match(section, /<div id=\{FEES_SECTION_ID\}/);
    assert.match(section, /export const FEES_SECTION_ID = "fees";/);
  });
  test("homepage section links never use a plain Link (it does nothing when the URL already has that hash)", () => {
    for (const f of ["src/components/shared/cta-banner.tsx", "src/components/home/hero.tsx", "src/components/home/learning-path.tsx", "src/components/layout/nav-links.tsx", "src/components/layout/footer.tsx"]) {
      assert.doesNotMatch(read(f), /<Link\s+href="\/#/, f);
    }
    assert.match(read("src/components/shared/section-link.tsx"), /scrollIntoView/);
  });
});

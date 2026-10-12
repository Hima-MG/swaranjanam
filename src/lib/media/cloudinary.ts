import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { UPLOAD_RULES, type UploadKind } from "@/lib/media/config";

// Signed, direct-from-browser uploads to Cloudinary.
//
// 1. The server authorises the teacher for the course, then signs a fixed set
//    of upload parameters, including a server-chosen `public_id` inside that
//    course's folder and the allowed formats. CLOUDINARY_API_SECRET never
//    leaves the server.
// 2. The browser uploads the file straight to Cloudinary with that signature.
//    Large videos never pass through Vercel's request-size limit.
// 3. Before anything is saved, the server verifies the response signature and
//    re-reads the asset from Cloudinary's Admin API to check size and format.
//    Rejected assets are deleted.
//
// Cloudinary delivery URLs are public. Only enrolled students are shown them,
// but anyone given a URL can open it: this is access control, not DRM.

export class MediaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaConfigError";
  }
}

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

function readConfig() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  const missing = [
    !cloudName && "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new MediaConfigError(`Missing Cloudinary environment variables: ${missing.join(", ")}`);
  }
  const rootFolder = (process.env.CLOUDINARY_UPLOAD_FOLDER?.trim() || "swaranjanam").replace(/^\/+|\/+$/g, "");
  return { cloudName: cloudName!, apiKey: apiKey!, apiSecret: apiSecret!, rootFolder };
}

/** Cloudinary's request signature: SHA-1 of sorted `key=value` pairs joined by `&`, plus the secret. */
function sign(params: Record<string, string | number>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(payload + apiSecret).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** Folder every asset for a course lives under. Ids are validated so they cannot escape it. */
export function courseFolder(courseId: string): string {
  if (!SAFE_SEGMENT.test(courseId)) throw new MediaValidationError("Invalid course id.");
  return `${readConfig().rootFolder}/courses/${courseId}`;
}

export interface UploadTicket {
  uploadUrl: string;
  fields: Record<string, string>;
  publicId: string;
  resourceType: "image" | "video";
  maxBytes: number;
}

/** Folder for one student's practice submissions. */
export function submissionFolder(studentId: string): string {
  if (!SAFE_SEGMENT.test(studentId)) throw new MediaValidationError("Invalid student id.");
  return `${readConfig().rootFolder}/submissions/${studentId}`;
}

/**
 * Signs a single upload into `prefix` (a folder ending in "/"). Signatures are
 * valid for one hour (Cloudinary rejects older timestamps).
 */
function ticketFor(prefix: string, kind: UploadKind): UploadTicket {
  const { cloudName, apiKey, apiSecret } = readConfig();
  const rule = UPLOAD_RULES[kind];
  const publicId = `${prefix}${randomUUID()}`;
  const params = {
    public_id: publicId,
    timestamp: Math.floor(Date.now() / 1000),
    allowed_formats: rule.formats.join(","),
    overwrite: "false",
  };
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${rule.resourceType}/upload`,
    fields: {
      api_key: apiKey,
      public_id: params.public_id,
      timestamp: String(params.timestamp),
      allowed_formats: params.allowed_formats,
      overwrite: params.overwrite,
      signature: sign(params, apiSecret),
    },
    publicId,
    resourceType: rule.resourceType,
    maxBytes: rule.maxBytes,
  };
}

/** Course media. Callers must have already authorised the teacher for `courseId`. */
export function createUploadTicket(courseId: string, kind: UploadKind, purpose: "thumbnail" | "resource"): UploadTicket {
  return ticketFor(`${courseFolder(courseId)}/${purpose}s/`, kind);
}

/** A student's practice recording. Callers must have authorised the student for the course. */
export function createSubmissionUploadTicket(studentId: string, kind: "audio" | "video"): UploadTicket {
  return ticketFor(`${submissionFolder(studentId)}/`, kind);
}

/** What the browser reports back after a successful upload. Treated as untrusted. */
export interface UploadReceipt {
  publicId: string;
  version: number;
  signature: string;
}

export interface VerifiedAsset {
  publicId: string;
  resourceType: "image" | "video";
  url: string;
  format: string;
  bytes: number;
}

function adminAuthHeader(apiKey: string, apiSecret: string) {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`;
}

/**
 * Confirms an upload is genuine, belongs to this course, and meets the rules
 * for `kind`. Deletes the asset and throws MediaValidationError otherwise.
 */
export function verifyUploadedAsset(
  courseId: string,
  kind: UploadKind,
  purpose: "thumbnail" | "resource",
  receipt: UploadReceipt,
): Promise<VerifiedAsset> {
  return verifyInFolder(`${courseFolder(courseId)}/${purpose}s/`, kind, receipt);
}

/** Same checks for a student's practice upload (must be in that student's folder). */
export function verifySubmissionAsset(studentId: string, kind: "audio" | "video", receipt: UploadReceipt): Promise<VerifiedAsset> {
  return verifyInFolder(`${submissionFolder(studentId)}/`, kind, receipt);
}

async function verifyInFolder(expectedPrefix: string, kind: UploadKind, receipt: UploadReceipt): Promise<VerifiedAsset> {
  const { cloudName, apiKey, apiSecret } = readConfig();
  const rule = UPLOAD_RULES[kind];

  if (
    typeof receipt.publicId !== "string" ||
    !receipt.publicId.startsWith(expectedPrefix) ||
    !SAFE_SEGMENT.test(receipt.publicId.slice(expectedPrefix.length)) ||
    !Number.isSafeInteger(receipt.version) ||
    typeof receipt.signature !== "string"
  ) {
    throw new MediaValidationError("The upload could not be verified. Please try again.");
  }

  // Signature Cloudinary returns with every upload response.
  const expected = sign({ public_id: receipt.publicId, version: receipt.version }, apiSecret);
  if (!safeEqual(expected, receipt.signature)) {
    throw new MediaValidationError("The upload could not be verified. Please try again.");
  }

  // Authoritative details straight from Cloudinary.
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/${rule.resourceType}/upload/${receipt.publicId
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { headers: { Authorization: adminAuthHeader(apiKey, apiSecret) }, cache: "no-store" },
  );
  if (!response.ok) {
    throw new MediaValidationError(
      response.status === 404
        ? "The uploaded file was not found on the media server. Please upload it again."
        : "Could not confirm the upload with the media server. Please try again.",
    );
  }
  const asset = (await response.json()) as {
    public_id: string;
    resource_type: string;
    format?: string;
    bytes: number;
    secure_url: string;
    is_audio?: boolean;
  };

  const format = (asset.format ?? "").toLowerCase();
  let problem: string | null = null;
  if (asset.resource_type !== rule.resourceType || !rule.formats.includes(format)) {
    problem = `Unsupported file type. Please upload a ${rule.label}.`;
  } else if (asset.bytes > rule.maxBytes) {
    problem = `The file is too large. Please upload a ${rule.label}.`;
  } else if (kind === "audio" && asset.is_audio === false) {
    problem = "That file does not contain audio.";
  }
  if (problem) {
    await deleteAsset(asset.public_id, rule.resourceType);
    throw new MediaValidationError(problem);
  }

  return {
    publicId: asset.public_id,
    resourceType: rule.resourceType,
    url: asset.secure_url,
    format,
    bytes: asset.bytes,
  };
}

/**
 * Deletes an asset. Best effort: failures are logged (without secrets) and
 * swallowed, so a Cloudinary outage never blocks removing a lesson resource.
 */
export async function deleteAsset(publicId: string, resourceType: "image" | "video"): Promise<void> {
  try {
    const { cloudName, apiKey, apiSecret } = readConfig();
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: "true" };
    const body = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      api_key: apiKey,
      signature: sign(params, apiSecret),
    });
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
      method: "POST",
      body,
      cache: "no-store",
    });
    if (!response.ok) console.error("[media] Cloudinary destroy failed with status", response.status);
  } catch (error) {
    console.error("[media] Cloudinary destroy failed:", (error as Error).name);
  }
}

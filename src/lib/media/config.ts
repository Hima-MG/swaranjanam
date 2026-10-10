import type { ResourceType } from "@/lib/lms/types";

// Upload rules shared by the browser (early feedback) and the server (the
// authoritative check, run against Cloudinary's own record of the asset).

const MB = 1024 * 1024;

export type UploadKind = ResourceType;

export interface UploadRule {
  /** Cloudinary resource type the file is uploaded as. Audio uploads as "video". */
  resourceType: "image" | "video";
  /** Formats Cloudinary must detect (signed as `allowed_formats`). */
  formats: string[];
  /** MIME types offered in the file picker. */
  accept: string[];
  maxBytes: number;
  label: string;
}

/**
 * Size limits stay at or below Cloudinary's free-plan per-file limits
 * (10 MB images, 100 MB video) because uploads are sent in a single request.
 */
export const UPLOAD_RULES: Record<UploadKind, UploadRule> = {
  image: {
    resourceType: "image",
    formats: ["jpg", "jpeg", "png", "webp"],
    accept: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 10 * MB,
    label: "JPG, PNG or WebP image, up to 10 MB",
  },
  pdf: {
    resourceType: "image",
    formats: ["pdf"],
    accept: ["application/pdf"],
    maxBytes: 10 * MB,
    label: "PDF, up to 10 MB",
  },
  audio: {
    resourceType: "video",
    formats: ["mp3", "m4a", "aac", "wav", "ogg"],
    accept: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg"],
    maxBytes: 50 * MB,
    label: "MP3, M4A, AAC, WAV or OGG audio, up to 50 MB",
  },
  video: {
    resourceType: "video",
    formats: ["mp4", "mov", "webm", "m4v"],
    accept: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"],
    maxBytes: 100 * MB,
    label: "MP4, MOV or WebM video, up to 100 MB",
  },
};

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/** Browser-side pre-check. Returns an error message, or null when the file looks acceptable. */
export function checkFileForUpload(kind: UploadKind, file: { name: string; size: number }): string | null {
  const rule = UPLOAD_RULES[kind];
  if (file.size === 0) return "That file is empty.";
  if (file.size > rule.maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(rule.maxBytes)}.`;
  }
  if (!rule.formats.includes(fileExtension(file.name))) {
    return `Unsupported file type. Please choose a ${rule.label}.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

// --- External video links ----------------------------------------------------

/**
 * Only YouTube and Vimeo links are accepted as external video. They are
 * converted to the provider's embed URL so students never leave the lesson.
 * Returns null for anything else.
 */
export function toApprovedVideoEmbed(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const idPattern = /^[A-Za-z0-9_-]{6,20}$/;

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    return id && idPattern.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return idPattern.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/|$)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

/** Hosts the lesson player will load in an iframe. */
export const EMBED_HOSTS = ["www.youtube-nocookie.com", "player.vimeo.com"];

/** Download URL for a Cloudinary file: asks Cloudinary to send it as an attachment. */
export function attachmentUrl(url: string): string {
  return url.replace("/upload/", "/upload/fl_attachment/");
}

"use client";

// Browser half of the signed upload flow (see lib/media/cloudinary.ts).
// The ticket comes from a Server Action that has already authorised the
// teacher; it contains a signature, never the API secret.

export interface UploadTicketLike {
  uploadUrl: string;
  fields: Record<string, string>;
}

export interface UploadReceiptLike {
  publicId: string;
  version: number;
  signature: string;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** Uploads straight to Cloudinary, reporting progress from 0 to 1. Abort with `signal`. */
export function uploadToCloudinary(
  ticket: UploadTicketLike,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadReceiptLike> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.uploadUrl);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response as {
        public_id?: string;
        version?: number;
        signature?: string;
        error?: { message?: string };
      } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.public_id && body.version && body.signature) {
        onProgress(1);
        resolve({ publicId: body.public_id, version: body.version, signature: body.signature });
        return;
      }
      const reason = body?.error?.message;
      reject(
        new UploadError(
          reason
            ? `The media server rejected the file: ${reason}`
            : `Upload failed (status ${xhr.status}). Please try again.`,
        ),
      );
    };
    xhr.onerror = () => reject(new UploadError("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new UploadError("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

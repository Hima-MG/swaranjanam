// Class / programme-session recordings hosted on YouTube (pure, no I/O).
// Only a validated 11-character video id is stored — never the pasted URL.
// Accepted: https://www.youtube.com/watch?v=ID, https://youtube.com/watch?v=ID,
// https://m.youtube.com/watch?v=ID and https://youtu.be/ID (extra query
// parameters such as &t=30s or ?si=… are ignored). Everything else is rejected.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com"]);

export function isValidVideoId(value: unknown): value is string {
  return typeof value === "string" && VIDEO_ID.test(value);
}

/** The video id of an accepted YouTube URL, or null. */
export function parseYouTubeVideoId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    id = parts.length === 1 ? parts[0] : null;
  } else if (WATCH_HOSTS.has(host) && url.pathname === "/watch") {
    id = url.searchParams.get("v");
  }
  return isValidVideoId(id) ? id : null;
}

/** Privacy-enhanced embed URL for a stored (validated) id. */
export function youTubeEmbedUrl(videoId: string): string {
  if (!isValidVideoId(videoId)) throw new Error("Invalid video id");
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
}

export function youTubeWatchUrl(videoId: string): string {
  if (!isValidVideoId(videoId)) throw new Error("Invalid video id");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export const RECORDING_URL_ERROR = "Enter a YouTube link like https://www.youtube.com/watch?v=… or https://youtu.be/…";

"use client";

import { Download, ExternalLink } from "lucide-react";
import Image from "next/image";

import { RESOURCE_TYPE_LABELS, ResourceIcon } from "@/components/lms/resource-icon";
import { Button } from "@/components/ui/button";
import { attachmentUrl, EMBED_HOSTS } from "@/lib/media/config";
import type { LessonResource } from "@/lib/lms/types";

function isAllowedEmbed(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && EMBED_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function Media({ resource }: { resource: LessonResource }) {
  switch (resource.type) {
    case "video":
      if (resource.source === "external") {
        return isAllowedEmbed(resource.url) ? (
          <div className="relative aspect-video overflow-hidden rounded-xl bg-brown">
            <iframe
              src={resource.url}
              title={resource.title}
              className="absolute inset-0 size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <p className="text-sm text-destructive">This video link cannot be played.</p>
        );
      }
      return (
        <video
          controls
          preload="metadata"
          playsInline
          controlsList="nodownload"
          className="aspect-video w-full rounded-xl bg-brown"
          src={resource.url}
        >
          Your browser cannot play this video.
        </video>
      );
    case "audio":
      return (
        <audio controls preload="metadata" controlsList="nodownload" className="w-full" src={resource.url}>
          Your browser cannot play this audio.
        </audio>
      );
    case "pdf":
      return (
        <object
          data={resource.url}
          type="application/pdf"
          aria-label={resource.title}
          className="hidden h-[70vh] w-full rounded-xl border border-border bg-ivory md:block"
        >
          <p className="p-4 text-sm text-muted-foreground">
            Your browser cannot show PDFs here. Use “Open PDF” below.
          </p>
        </object>
      );
    case "image":
      return (
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-ivory">
          <Image src={resource.url} alt={resource.title} fill sizes="(min-width: 1024px) 720px, 100vw" className="object-contain" />
        </div>
      );
  }
}

/** One lesson resource: player/viewer plus the actions the teacher allowed. */
export function ResourceViewer({ resource }: { resource: LessonResource }) {
  const canDownload = resource.downloadable && resource.source === "cloudinary";
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <header className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-maroon-soft text-maroon">
          <ResourceIcon type={resource.type} className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 lang={resource.language} className="font-semibold break-words text-brown">
            {resource.title}
          </h3>
          <p className="text-xs text-muted-foreground">{RESOURCE_TYPE_LABELS[resource.type]}</p>
        </div>
      </header>
      <Media resource={resource} />
      {(resource.type === "pdf" || canDownload) && (
        <div className="flex flex-wrap gap-2">
          {resource.type === "pdf" && (
            <Button asChild variant="outline" size="sm">
              <a href={resource.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink data-icon="inline-start" />
                Open PDF
              </a>
            </Button>
          )}
          {canDownload && (
            <Button asChild variant="outline" size="sm">
              <a href={attachmentUrl(resource.url)} download={resource.fileName ?? undefined}>
                <Download data-icon="inline-start" />
                Download
              </a>
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

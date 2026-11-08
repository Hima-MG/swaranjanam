"use client";

import { PlayCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { youTubeEmbedUrl } from "@/lib/lms/recordings";

export interface RecordingListItem {
  key: string;
  /** e.g. "Class 01 – Sarali varisai". */
  label: string;
  dateLabel: string;
  videoId: string | null;
}

/** Chronological recordings; the player is embedded only after the learner presses Watch. */
export function RecordingList({ items, emptyText }: { items: RecordingListItem[]; emptyText: string }) {
  const [playing, setPlaying] = useState<string | null>(null);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium break-words text-brown">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.dateLabel}</span>
            </div>
            {item.videoId ? (
              <Button type="button" size="sm" variant={playing === item.key ? "outline" : "default"} onClick={() => setPlaying(playing === item.key ? null : item.key)}>
                <PlayCircle data-icon="inline-start" />
                {playing === item.key ? "Close" : "Watch"}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Recording not available yet</span>
            )}
          </div>
          {item.videoId && playing === item.key && (
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
              <iframe
                src={youTubeEmbedUrl(item.videoId)}
                title={item.label}
                className="size-full"
                allow="encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

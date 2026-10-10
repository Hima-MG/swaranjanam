import { FileText, Image as ImageIcon, Music, Video } from "lucide-react";

import type { ResourceType } from "@/lib/lms/types";

const icons = { video: Video, audio: Music, pdf: FileText, image: ImageIcon } as const;

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  image: "Image",
};

export function ResourceIcon({ type, className }: { type: ResourceType; className?: string }) {
  const Icon = icons[type];
  return <Icon className={className} aria-hidden="true" />;
}

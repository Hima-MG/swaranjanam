import { Music } from "lucide-react";
import Image from "next/image";

import { Mandala } from "@/components/decor/mandala";
import { cn } from "@/lib/utils";

/** Course thumbnail for the dashboards; ornamental placeholder (as on the public site) when none is uploaded. */
export function LmsThumbnail({
  title,
  url,
  className,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
}: {
  title: string;
  url: string | null;
  className?: string;
  sizes?: string;
}) {
  return (
    <div className={cn("relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-maroon to-maroon-deep", className)}>
      {url ? (
        <Image src={url} alt={title} fill sizes={sizes} className="object-cover" />
      ) : (
        <>
          <Mandala className="absolute top-1/2 left-1/2 size-[80%] -translate-x-1/2 -translate-y-1/2 text-gold-light/40" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-cream/10 text-gold-light ring-1 ring-gold-light/30">
              <Music className="size-5" aria-hidden="true" />
            </span>
          </div>
        </>
      )}
    </div>
  );
}

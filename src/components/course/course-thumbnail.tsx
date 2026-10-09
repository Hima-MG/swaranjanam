import { CalendarDays, Flower2, Mic, Music, Sparkles, type LucideIcon } from "lucide-react";
import Image from "next/image";

import { Mandala } from "@/components/decor/mandala";
import { cn } from "@/lib/utils";
import type { Course, CourseCategory, CourseTone } from "@/types/course";

const toneStyles: Record<CourseTone, { surface: string; motif: string; icon: string }> = {
  maroon: {
    surface: "bg-gradient-to-br from-maroon to-maroon-deep",
    motif: "text-gold-light/50",
    icon: "bg-cream/10 text-gold-light ring-gold-light/30",
  },
  gold: {
    surface: "bg-gradient-to-br from-gold-soft to-gold-light",
    motif: "text-maroon/25",
    icon: "bg-ivory/60 text-maroon ring-maroon/20",
  },
  brown: {
    surface: "bg-gradient-to-br from-[#5b3a29] to-brown",
    motif: "text-gold/45",
    icon: "bg-cream/10 text-gold-light ring-gold/30",
  },
  rose: {
    surface: "bg-gradient-to-br from-maroon-soft to-[#e7c6c0]",
    motif: "text-maroon/25",
    icon: "bg-ivory/60 text-maroon ring-maroon/20",
  },
};

const categoryIcons: Record<CourseCategory, LucideIcon> = {
  Foundations: Music,
  "Vocal Training": Mic,
  Children: Sparkles,
  Devotional: Flower2,
  Workshops: CalendarDays,
};

interface CourseThumbnailProps {
  course: Pick<Course, "title" | "image" | "tone" | "category">;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

/** Course image, or a generated ornamental placeholder when no image exists. */
export function CourseThumbnail({
  course,
  className,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority,
}: CourseThumbnailProps) {
  const style = toneStyles[course.tone];
  const Icon = categoryIcons[course.category];

  return (
    <div className={cn("relative aspect-[4/3] overflow-hidden", style.surface, className)}>
      {course.image ? (
        <Image
          src={course.image}
          alt={course.title}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <>
          <Mandala
            className={cn(
              "absolute top-1/2 left-1/2 size-[85%] -translate-x-1/2 -translate-y-1/2 transition-transform duration-700 group-hover:rotate-12",
              style.motif,
            )}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                "flex size-16 items-center justify-center rounded-full ring-1 backdrop-blur-sm",
                style.icon,
              )}
            >
              <Icon className="size-7" aria-hidden="true" />
            </span>
          </div>
        </>
      )}
    </div>
  );
}

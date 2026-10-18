import {
  Award,
  CalendarDays,
  GraduationCap,
  HeartHandshake,
  Laptop,
  Music,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

// Marketing copy for public pages. Do not add statistics, ratings, student
// counts or testimonials here: student testimonials come only from approved,
// consented submissions (lib/lms/server/testimonials.ts).

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface JourneyStep {
  step: string;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: GraduationCap,
    title: "Guru–Shishya Tradition",
    description:
      "Learn the way Carnatic music has always been taught — through close guidance, listening and repetition.",
  },
  {
    icon: Laptop,
    title: "Live & Recorded Classes",
    description:
      "Attend live interactive sessions and revisit recorded lessons whenever you need to practise.",
  },
  {
    icon: Users,
    title: "Small Batches",
    description:
      "Intimate batch sizes ensure every student receives individual attention and correction.",
  },
  {
    icon: CalendarDays,
    title: "Flexible Schedules",
    description:
      "Morning, evening and weekend batches across time zones for students in India and abroad.",
  },
  {
    icon: Award,
    title: "Structured Progression",
    description:
      "A clear path from Sarali Varisai to kritis and manodharma, with regular assessments.",
  },
  {
    icon: HeartHandshake,
    title: "For Every Age",
    description:
      "Dedicated programmes for children, adults and families who want to sing together.",
  },
];

export const journey: JourneyStep[] = [
  {
    step: "01",
    title: "Foundations",
    description: "Sruti, swara and tala through Sarali, Janta and Alankaram.",
  },
  {
    step: "02",
    title: "First Compositions",
    description: "Geethams and simple songs that bring swaras to life.",
  },
  {
    step: "03",
    title: "Repertoire",
    description: "Varnams and kritis with raga awareness and gamakas.",
  },
  {
    step: "04",
    title: "Performance",
    description: "Manodharma, improvisation and concert preparation.",
  },
];

export const learningModes: Feature[] = [
  {
    icon: Video,
    title: "Live Online",
    description: "Real-time classes with personal correction from your teacher.",
  },
  {
    icon: Music,
    title: "Recorded Lessons",
    description: "Learn at your own pace and replay lessons as often as you like.",
  },
  {
    icon: Users,
    title: "Hybrid",
    description: "Recorded lessons combined with weekly live review sessions.",
  },
];

export const values: Feature[] = [
  {
    icon: Music,
    title: "Authenticity",
    description:
      "We preserve the grammar and aesthetics of the Carnatic tradition in every lesson.",
  },
  {
    icon: HeartHandshake,
    title: "Care",
    description:
      "Each student's voice is different. We teach with patience and personal attention.",
  },
  {
    icon: Award,
    title: "Excellence",
    description:
      "Clear standards and regular feedback help students grow with confidence.",
  },
];

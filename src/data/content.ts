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
    title: "Live Online Classes",
    description:
      "One-hour live classes on Google Meet, once a week. Every class is recorded and shared privately with you to practise from.",
  },
  {
    icon: Users,
    title: "Small Batches",
    description:
      "Batches of up to five students, so every student receives individual attention and correction.",
  },
  {
    icon: CalendarDays,
    title: "For India & Abroad",
    description:
      "Classes on any day except Sunday, with batch timings fixed to suit students in India and abroad.",
  },
  {
    icon: Award,
    title: "Your Own Pace",
    description:
      "No fixed course duration: step by step through varisais and alankarams, with notations, lyrics and practice widgets on your dashboard.",
  },
  {
    icon: HeartHandshake,
    title: "For Every Age",
    description:
      "Swara Foundation for adults and Little Swaras for kids, in small batches or one-to-one.",
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
    title: "Live on Google Meet",
    description: "One-hour classes, once a week, with personal correction from your teacher.",
  },
  {
    icon: Users,
    title: "Batch or Individual",
    description: "Small batches of up to five students, or one-to-one individual classes.",
  },
  {
    icon: Music,
    title: "Recordings & Materials",
    description: "Private class recordings, notations, lyrics and practice widgets on your student dashboard.",
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

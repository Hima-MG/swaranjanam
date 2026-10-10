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

// Marketing copy for public pages. Figures and testimonials are placeholders
// and should be replaced with verified academy data before launch.

export interface Stat {
  value: string;
  label: string;
}

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

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

export const stats: Stat[] = [
  { value: "500+", label: "Students taught" },
  { value: "15+", label: "Years of teaching" },
  { value: "4.9", label: "Average rating" },
];

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

export const testimonials: Testimonial[] = [
  {
    quote:
      "The classes are patient and well structured. My daughter now practises every day without being reminded.",
    name: "Lakshmi R.",
    role: "Parent, Vocal for Children",
  },
  {
    quote:
      "I started as a complete beginner in my thirties. The step-by-step approach made Carnatic music feel achievable.",
    name: "Arjun K.",
    role: "Student, Basics for Beginners",
  },
  {
    quote:
      "Recorded lessons alongside live correction is the perfect balance for someone with a busy schedule.",
    name: "Meera S.",
    role: "Student, Intermediate",
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

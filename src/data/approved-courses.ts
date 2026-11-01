import type { CourseAvailability, CourseCategory, CourseLevel } from "@/types/course";

// The academy's APPROVED course catalogue, from the course details workbook
// supplied by the academy ("Course Details" sheet). It is the public fallback
// for a course that does not exist in Firestore yet: as soon as a teacher
// creates a course with the same slug, the Firestore course (and its teacher-
// set availability) is used instead. Nothing here is written to the database.
//
// Only confirmed details are included. Cells the workbook marks as
// suggestions awaiting confirmation (e.g. the suggested age range for Little
// Swaras) are left out. Fees are NOT stored here: "open" courses show the
// academy's current per-session rates (lib/catalog/public-pricing.ts) and
// "coming_soon" courses show "Fees to be announced".

export interface ApprovedCourse {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  audience: string;
  level: CourseLevel | null;
  category: CourseCategory | null;
  availability: CourseAvailability;
  /** What is taught (shown as "What you will learn"). */
  content: string[];
  featured: boolean;
}

/** Class format shared by every open course (workbook "Class Details"). */
export const CLASS_DETAILS: readonly string[] = [
  "Live online class on Google Meet, 1 hour, once a week",
  "Small batches of up to 5 students",
  "Class recordings shared privately with each student",
  "Notations, lyrics and interactive self-learning widgets on your personal student dashboard",
];

const FOUNDATION_CONTENT = [
  "Introductory concepts: sruti, talam and the saptaswara ladder",
  "Sarali Varisai (14), Madhyasthayi Varisai (5) and Jantai Varisai (9)",
  "Dhattu Varisai (2), Melsthayi Varisai (5) and Mandrasthayi Varisai (5)",
  "Sapta Tala Alankaram (7)",
  "Bhajans and devotional songs",
  "Voice culture tips, singing tips and practice techniques",
];

export const APPROVED_COURSES: readonly ApprovedCourse[] = [
  {
    slug: "swara-foundation",
    title: "Swara Foundation (Adults)",
    subtitle: "A beginner's course in Carnatic vocal music for adults.",
    description:
      "A beginner's course in Carnatic vocal music for adults. Learn to sing in sruti, keep talam and build a strong, steady voice through the traditional varisai and alankaram exercises, along with bhajans and devotional songs – at your own pace, in a small batch.",
    audience: "Beginners – adults (no prior training needed)",
    level: "Beginner",
    category: "Foundations",
    availability: "open",
    content: FOUNDATION_CONTENT,
    featured: true,
  },
  {
    slug: "little-swaras",
    title: "Little Swaras (Kids)",
    subtitle: "The Swara Foundation course for children, taught in a friendly, playful way.",
    description:
      "The Swara Foundation course for children, taught in a friendly, playful way. Kids learn sruti, talam and the basic varisais step by step, along with simple bhajans and devotional songs, building a love for music from the very first class.",
    audience: "Beginners – kids",
    level: "Beginner",
    category: "Children",
    availability: "open",
    content: FOUNDATION_CONTENT,
    featured: true,
  },
  {
    slug: "devotional-songs",
    title: "Devotional Songs",
    subtitle: "Bhajans and devotional songs for all ages.",
    description: "Bhajans and devotional songs for all ages.",
    audience: "",
    level: null,
    category: "Devotional",
    availability: "coming_soon",
    content: [],
    featured: false,
  },
  {
    slug: "voice-culture",
    title: "Voice Culture",
    subtitle: "A focused course on breathing, voice strength, range and voice care.",
    description: "A focused course on breathing, voice strength, range and voice care.",
    audience: "",
    level: null,
    category: "Vocal Training",
    availability: "coming_soon",
    content: [],
    featured: false,
  },
  {
    slug: "intermediate-level",
    title: "Intermediate Level",
    subtitle: "The next step after Swara Foundation.",
    description: "The next step after Swara Foundation.",
    audience: "Students who have completed the beginner level",
    level: "Intermediate",
    category: "Vocal Training",
    availability: "coming_soon",
    content: [],
    featured: false,
  },
  {
    slug: "advanced-level",
    title: "Advanced Level",
    subtitle: "Advanced repertoire and creativity.",
    description: "Advanced repertoire and creativity.",
    audience: "Advanced learners",
    level: "Advanced",
    category: "Vocal Training",
    availability: "coming_soon",
    content: [],
    featured: false,
  },
];

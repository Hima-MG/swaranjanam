// Site-wide configuration. Email and Instagram are the academy's supplied
// details; phone, WhatsApp, address and hours are still placeholders —
// replace them with real details before launch.
export const siteConfig = {
  name: "Swaraanjanam",
  fullName: "Swaraanjanam Carnatic Music Academy",
  tagline: "Carnatic Music Academy",
  description:
    "Learn Carnatic vocal music the traditional way — guided by experienced gurus, structured for modern learners, online and in person.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  contact: {
    email: "swaraanjanammusicacademy@gmail.com",
    phone: "+91 00000 00000",
    whatsapp: "+91 00000 00000",
    address: "Hyderabad, Telangana, India",
    hours: "Mon – Sat, 7:00 AM – 8:00 PM IST",
  },
  social: {
    instagram: { handle: "@swaraanjanam", url: "https://www.instagram.com/swaraanjanam/" },
    /**
     * YouTube channel. Set NEXT_PUBLIC_YOUTUBE_URL once the channel is ready;
     * the link stays hidden until then.
     */
    youtubeUrl: process.env.NEXT_PUBLIC_YOUTUBE_URL?.trim() || null,
  },
  /** The academy's motto, from the supplied About text. */
  motto: "Different roads. One beautiful destination.",
  founder: {
    name: "Dr. Anjana R. Menon",
    /** Founder photograph (portrait JPEG, 1200 × 1600). Set to null to show the placeholder. */
    photo: { src: "/images/founder-anjana.jpeg", width: 1200, height: 1600 } as {
      src: string;
      width: number;
      height: number;
    } | null,
  },
} as const;

export type NavItem = { label: string; href: string };

export const mainNav: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Courses", href: "/courses" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

// The footer's "Popular Courses" column is built from published courses in
// Firestore (components/layout/footer.tsx), not listed here.
export const footerNav: { title: string; items: NavItem[] }[] = [
  {
    title: "Academy",
    items: [
      { label: "About Us", href: "/about" },
      { label: "All Courses", href: "/courses" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Students",
    items: [
      { label: "Login", href: "/login" },
      { label: "Register", href: "/register" },
    ],
  },
];

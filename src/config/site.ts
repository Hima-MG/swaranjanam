// Site-wide configuration. Contact details below are placeholders — replace
// them with the academy's real details before launch.
export const siteConfig = {
  name: "Swaranjanam",
  fullName: "Swaranjanam Carnatic Music Academy",
  tagline: "Carnatic Music Academy",
  description:
    "Learn Carnatic vocal music the traditional way — guided by experienced gurus, structured for modern learners, online and in person.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  contact: {
    email: "hello@swaranjanam.example",
    phone: "+91 00000 00000",
    whatsapp: "+91 00000 00000",
    address: "Hyderabad, Telangana, India",
    hours: "Mon – Sat, 7:00 AM – 8:00 PM IST",
  },
} as const;

export type NavItem = { label: string; href: string };

export const mainNav: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Courses", href: "/courses" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

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
    title: "Popular Courses",
    items: [
      { label: "Basics for Beginners", href: "/courses/basics-for-beginners" },
      { label: "Vocal for Children", href: "/courses/vocal-for-children" },
      { label: "Sarali Varisai", href: "/courses/sarali-varisai" },
      { label: "Short Workshops", href: "/courses/short-workshops" },
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

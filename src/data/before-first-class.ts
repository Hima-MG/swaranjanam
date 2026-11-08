// From the academy's course details workbook ("Course Details" → Course Content, and the
// "Before First Class" sheet), verbatim. Shown on the Swara Foundation and Little Swaras pages.

/** Courses the workbook's class structure and "Before First Class" sheet apply to. */
export const WORKBOOK_FOUNDATION_SLUGS: readonly string[] = ["swara-foundation", "little-swaras"];

/** Workbook "Course Content": what happens in each class. */
export const CLASS_STRUCTURE = "Each class: warm-up and voice culture, revision of the previous lesson, new lesson, and practice guidance for the week.";

/** Workbook "Before First Class" sheet. */
export const BEFORE_FIRST_CLASS = [
  {
    item: "Get the textbook",
    details:
      "We will be using Sangeetha Sampoorna – Beginners Level by Dr. Anuradha Mahesh (Shanmukhapriya Publications) as our reference book. Please try to get a copy before the class. Price: ₹500 (India) | $50 (USA/abroad).",
    how: "Order on WhatsApp: 80757 56318",
    link: "https://anuradhamahesh.wordpress.com/1-sangeetha-sampoorna-beginners-level-book-3rd-edition/1-sangeetha-sampoorna-beginners-level/",
  },
  {
    item: "Download the Jalra app",
    details: "We will be using the Jalra app for sruti and tala setup during class. Please download it before your first session.",
    how: 'Search "Jalra" on the Google Play Store or App Store.',
    link: null,
  },
] as const;

import { Mail, MapPin, Phone } from "lucide-react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Fragment, Suspense } from "react";

import { Logo } from "@/components/layout/logo";
import { InstagramIcon, YouTubeIcon } from "@/components/shared/social-icons";
import { Container } from "@/components/ui/container";
import { footerNav, siteConfig, type NavItem } from "@/config/site";
import { featuredCourses, getPublishedCourses } from "@/lib/catalog/server";

// `new Date()` is not allowed in the prerendered shell under Cache Components,
// so the year is computed inside a cached scope.
async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}

const { social } = siteConfig;

const contactItems = [
  { icon: Mail, label: siteConfig.contact.email, href: `mailto:${siteConfig.contact.email}` },
  { icon: InstagramIcon, label: `Instagram ${social.instagram.handle}`, href: social.instagram.url },
  ...(social.youtubeUrl ? [{ icon: YouTubeIcon, label: "YouTube channel", href: social.youtubeUrl }] : []),
  { icon: Phone, label: siteConfig.contact.phone, href: `tel:${siteConfig.contact.phone.replace(/\s/g, "")}` },
  { icon: MapPin, label: siteConfig.contact.address },
];

const ALL_COURSES: NavItem = { label: "All courses", href: "/courses" };

function FooterColumn({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div>
      <h3 className="font-sans type-eyebrow text-gold-light">{title}</h3>
      <ul className="mt-5 flex flex-col gap-3 text-sm">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="text-cream/75 transition-colors hover:text-gold-light">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Featured published courses from Firestore (cached with the catalogue). */
async function PopularCourses() {
  const result = await getPublishedCourses();
  const items = result.ok
    ? featuredCourses(result.data, 4).map((course) => ({ label: course.title, href: `/courses/${course.slug}` }))
    : [];
  return <FooterColumn title="Popular Courses" items={items.length > 0 ? items : [ALL_COURSES]} />;
}

export function Footer() {
  return (
    <footer className="relative isolate mt-auto bg-maroon-deep pattern-kolam-light text-cream">
      <div className="h-1 bg-gradient-to-r from-gold/0 via-gold to-gold/0" aria-hidden="true" />
      <Container className="grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-5">
          <Logo inverted />
          <p className="max-w-sm text-sm leading-relaxed text-cream/75">{siteConfig.description}</p>
          <ul className="flex flex-col gap-3 text-sm">
            {contactItems.map(({ icon: Icon, label, href }) => (
              <li key={label} className="flex items-center gap-3 text-cream/85">
                <Icon className="size-4 shrink-0 text-gold-light" aria-hidden="true" />
                {href ? (
                  <a
                    href={href}
                    className="break-all transition-colors hover:text-gold-light"
                    {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {footerNav.map((group, index) => (
          <Fragment key={group.title}>
            <FooterColumn title={group.title} items={group.items} />
            {index === 0 && (
              <Suspense fallback={<FooterColumn title="Popular Courses" items={[ALL_COURSES]} />}>
                <PopularCourses />
              </Suspense>
            )}
          </Fragment>
        ))}
      </Container>

      <div className="border-t border-cream/10">
        <Container className="flex flex-col items-center justify-between gap-2 py-6 text-xs text-cream/60 sm:flex-row">
          <p>
            © <CurrentYear /> {siteConfig.fullName}. All rights reserved.
          </p>
          <p className="font-heading text-sm italic text-gold-light/80">
            Sangeetha jnanamu bhakti vina
          </p>
        </Container>
      </div>
    </footer>
  );
}

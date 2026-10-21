import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EnquiryForm } from "@/components/forms/enquiry-form";
import { FormField } from "@/components/forms/form-field";
import { PageHero } from "@/components/shared/page-hero";
import { InstagramIcon, YouTubeIcon } from "@/components/shared/social-icons";
import { Section } from "@/components/ui/section";
import { siteConfig } from "@/config/site";
import { getPublishedCourses } from "@/lib/catalog/server";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Swaraanjanam to book a free trial class or ask about our courses.",
};

const { contact, social } = siteConfig;

const contactDetails = [
  { icon: Mail, label: "Email", value: contact.email, href: `mailto:${contact.email}` },
  { icon: InstagramIcon, label: "Instagram", value: social.instagram.handle, href: social.instagram.url },
  ...(social.youtubeUrl ? [{ icon: YouTubeIcon, label: "YouTube", value: "Our channel", href: social.youtubeUrl }] : []),
  { icon: Phone, label: "Phone", value: contact.phone, href: `tel:${contact.phone.replace(/\s/g, "")}` },
  { icon: MessageCircle, label: "WhatsApp", value: contact.whatsapp, href: contact.whatsappUrl },
  { icon: MapPin, label: "Location", value: contact.address },
  { icon: Clock, label: "Hours", value: contact.hours },
];

const selectClassName =
  "h-11 w-full rounded-xl border border-input bg-ivory px-3.5 text-base text-brown outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function CourseSelect({ courses }: { courses: { slug: string; title: string }[] }) {
  return (
    <FormField id="course" label="Interested in">
      <select id="course" name="course" defaultValue="" className={selectClassName}>
        <option value="">Not sure yet</option>
        {courses.map((course) => (
          <option key={course.slug} value={course.slug}>
            {course.title}
          </option>
        ))}
      </select>
    </FormField>
  );
}

/** "Interested in" options: published courses from Firestore. */
async function PublishedCourseSelect() {
  const result = await getPublishedCourses();
  return <CourseSelect courses={result.ok ? result.data : []} />;
}

export default function ContactPage() {

  return (
    <>
      <PageHero
        eyebrow="Contact us"
        title="Let's begin your musical journey"
        description="Book a free trial class, ask about batches and fees, or simply say namaste. We usually reply within one working day."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
          <div className="flex flex-col gap-4">
            {contactDetails.map(({ icon: Icon, label, value, href }) => (
              <div
                key={label}
                className="flex items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-maroon-soft text-maroon">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="type-eyebrow text-gold">{label}</span>
                  {href ? (
                    <a
                      href={href}
                      className="font-medium break-all text-brown hover:text-maroon"
                      {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {value}
                    </a>
                  ) : (
                    <span className="font-medium text-brown">{value}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-border bg-card p-7 shadow-card sm:p-10">
            <h2 className="type-h3 mb-6">Send us a message</h2>
            <EnquiryForm
              whatsappUrl={contact.whatsappUrl}
              email={contact.email}
              courseSelect={
                <Suspense fallback={<CourseSelect courses={[]} />}>
                  <PublishedCourseSelect />
                </Suspense>
              }
            />
          </div>
        </div>
      </Section>
    </>
  );
}

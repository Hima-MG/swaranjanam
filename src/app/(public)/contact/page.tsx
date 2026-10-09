import { Clock, Mail, MapPin, MessageCircle } from "lucide-react";
import type { Metadata } from "next";

import { FormField } from "@/components/forms/form-field";
import { PlaceholderForm } from "@/components/forms/placeholder-form";
import { PageHero } from "@/components/shared/page-hero";
import { Section } from "@/components/ui/section";
import { Textarea } from "@/components/ui/textarea";
import { siteConfig } from "@/config/site";
import { getAllCourses } from "@/lib/courses";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Swaranjanam to book a free trial class or ask about our courses.",
};

const { contact } = siteConfig;

const contactDetails = [
  { icon: Mail, label: "Email", value: contact.email, href: `mailto:${contact.email}` },
  { icon: MessageCircle, label: "Phone / WhatsApp", value: contact.whatsapp, href: `tel:${contact.whatsapp.replace(/\s/g, "")}` },
  { icon: MapPin, label: "Location", value: contact.address },
  { icon: Clock, label: "Hours", value: contact.hours },
];

const selectClassName =
  "h-11 w-full rounded-xl border border-input bg-ivory px-3.5 text-base text-brown outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export default function ContactPage() {
  const courses = getAllCourses();

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
                    <a href={href} className="font-medium text-brown hover:text-maroon">
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
            <PlaceholderForm
              submitLabel="Send Message"
              notice="Thank you! Online enquiries will be enabled soon — please reach us by email or WhatsApp for now."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField id="name" label="Full name" autoComplete="name" required />
                <FormField id="email" label="Email address" type="email" autoComplete="email" required />
                <FormField id="phone" label="Phone / WhatsApp" type="tel" autoComplete="tel" />
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
              </div>
              <FormField id="message" label="Message">
                <Textarea
                  id="message"
                  name="message"
                  rows={5}
                  placeholder="Tell us about your musical background and goals"
                />
              </FormField>
            </PlaceholderForm>
          </div>
        </div>
      </Section>
    </>
  );
}

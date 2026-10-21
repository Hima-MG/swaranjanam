"use client";

import { Mail, MessageCircle } from "lucide-react";
import { useRef, useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { emailEnquiryUrl, ENQUIRY_LIMITS, parseEnquiry, whatsappEnquiryUrl } from "@/lib/contact-enquiry";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Contact enquiry. The website does not send or store anything: after the
 * details are checked, the visitor's WhatsApp opens with the enquiry
 * prefilled, and they press Send themselves. An email link with the same
 * text is offered for visitors who do not use WhatsApp.
 */
export function EnquiryForm({
  whatsappUrl,
  email,
  courseSelect,
}: {
  /** The academy's click-to-chat URL from site config, e.g. https://wa.me/918547545175 */
  whatsappUrl: string;
  email: string;
  /** The "Interested in" select (named `course`), rendered on the server. */
  courseSelect: React.ReactNode;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ready, setReady] = useState<{ whatsapp: string; email: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const invalid = (key: string) => (errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${key}-error` } : {});

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (opening) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const select = form.elements.namedItem("course");
        const course = select instanceof HTMLSelectElement && select.value ? (select.selectedOptions[0]?.text ?? "") : "";
        const { value, errors: found } = parseEnquiry({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          course,
          message: data.get("message"),
        });
        setErrors(found);
        if (!value) {
          setReady(null);
          const first = Object.keys(found)[0];
          (form.elements.namedItem(first) as HTMLElement | null)?.focus();
          return;
        }
        const links = { whatsapp: whatsappEnquiryUrl(whatsappUrl, value), email: emailEnquiryUrl(email, value) };
        setReady(links);
        // Opened from the submit click, so browsers allow the new tab.
        window.open(links.whatsapp, "_blank", "noopener,noreferrer");
        // Guard against double clicks opening several WhatsApp tabs.
        setOpening(true);
        window.setTimeout(() => setOpening(false), 2000);
        window.setTimeout(() => statusRef.current?.focus(), 0);
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Full name" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" maxLength={ENQUIRY_LIMITS.name} required {...invalid("name")} />
        </Field>
        <Field id="email" label="Email address" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" maxLength={ENQUIRY_LIMITS.email} required {...invalid("email")} />
        </Field>
        <Field id="phone" label="Phone / WhatsApp" error={errors.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={ENQUIRY_LIMITS.phone} {...invalid("phone")} />
        </Field>
        {courseSelect}
      </div>
      <Field id="message" label="Message" error={errors.message}>
        <Textarea
          id="message"
          name="message"
          rows={5}
          maxLength={ENQUIRY_LIMITS.message}
          placeholder="Tell us about your musical background and goals"
          {...invalid("message")}
        />
      </Field>

      <Button type="submit" size="lg" className="mt-1 w-full" disabled={opening}>
        <MessageCircle data-icon="inline-start" />
        Continue in WhatsApp
      </Button>
      <p className="-mt-2 text-xs text-muted-foreground">
        This opens WhatsApp with your message ready to send. Your enquiry reaches us only after you press Send in WhatsApp — nothing is sent
        from this website.
      </p>

      {Object.keys(errors).length > 0 && <FormAlert tone="error">Please fix the highlighted fields.</FormAlert>}

      {ready && (
        <div ref={statusRef} tabIndex={-1} role="status" className="flex flex-col gap-3 rounded-xl border border-gold/40 bg-gold-soft/60 p-4 text-sm text-brown outline-none">
          <p>
            <span className="font-semibold">Your message is ready in WhatsApp but has not been sent yet.</span> Press Send in WhatsApp to
            complete your enquiry.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={ready.whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle data-icon="inline-start" />
                Open WhatsApp again
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={ready.email}>
                <Mail data-icon="inline-start" />
                Send by email instead
              </a>
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

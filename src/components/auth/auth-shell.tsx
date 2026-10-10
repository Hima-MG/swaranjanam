import Link from "next/link";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { Logo } from "@/components/layout/logo";
import { Container } from "@/components/ui/container";

interface AuthShellProps {
  title: string;
  description: string;
  footer: { text: string; linkLabel: string; href: string };
  children: React.ReactNode;
}

/** Centered card layout shared by the login and register pages. */
export function AuthShell({ title, description, footer, children }: AuthShellProps) {
  return (
    <section className="relative isolate overflow-hidden bg-cream-deep/60 pattern-kolam-gold">
      <Mandala className="pointer-events-none absolute -top-40 -left-40 -z-10 size-[28rem] text-gold/30" />
      <Mandala className="pointer-events-none absolute -right-40 -bottom-40 -z-10 size-[28rem] text-gold/30" />
      <Container size="sm" className="flex justify-center py-14 sm:py-20">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-card sm:p-10">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <Logo variant="emblem" eager className="mb-2" />
            <h1 className="type-h2">{title}</h1>
            <Ornament />
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {footer.text}{" "}
            <Link href={footer.href} className="font-semibold text-maroon hover:underline">
              {footer.linkLabel}
            </Link>
          </p>
        </div>
      </Container>
    </section>
  );
}

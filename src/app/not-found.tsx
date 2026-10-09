import Link from "next/link";

import { Mandala } from "@/components/decor/mandala";
import { Ornament } from "@/components/decor/ornament";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden pattern-kolam-gold px-4 py-24">
        <Mandala className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[36rem] -translate-x-1/2 -translate-y-1/2 text-gold/25" />
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <p className="type-eyebrow text-gold">404</p>
          <h1 className="type-h1">This note is off-key</h1>
          <Ornament />
          <p className="text-muted-foreground">
            The page you are looking for does not exist or has moved.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/">Back to Home</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/courses">Browse Courses</Link>
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

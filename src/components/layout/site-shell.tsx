import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

/** Skip link + Navbar + main + Footer, shared by the public and account layouts. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-maroon px-4 py-2 text-cream focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}

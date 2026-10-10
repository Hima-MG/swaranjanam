import type { Metadata } from "next";

import { SiteShell } from "@/components/layout/site-shell";

// Signed-in areas. Each page verifies the session and role on the server.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: LayoutProps<"/">) {
  return <SiteShell>{children}</SiteShell>;
}

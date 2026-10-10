import { SiteShell } from "@/components/layout/site-shell";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <SiteShell>{children}</SiteShell>;
}

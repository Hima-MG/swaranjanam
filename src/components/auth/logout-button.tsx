"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading-state";
import { logout } from "@/lib/auth/client";

export function LogoutButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await logout();
        } finally {
          // refresh() re-renders server components and drops cached
          // authenticated UI (navbar, prefetched dashboards).
          router.replace("/");
          router.refresh();
          setPending(false);
        }
      }}
    >
      {pending ? <Spinner className="size-4" /> : <LogOut data-icon="inline-start" />}
      Log out
    </Button>
  );
}

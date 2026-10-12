import type { Metadata } from "next";
import { Suspense } from "react";

import { LogoutButton } from "@/components/auth/logout-button";
import { TeacherProfileForm } from "@/components/lms/teacher/operations-controls";
import { TeacherPageHeader } from "@/components/lms/teacher/teacher-page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { getUserProfile } from "@/lib/auth/profile";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings · Teacher" };

async function Settings() {
  const teacher = await requireRole("teacher", "/teacher/settings");
  const profile = await getUserProfile(teacher.uid);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="profile" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="profile" className="type-h3">Your profile</h2>
        <TeacherProfileForm displayName={profile?.displayName ?? teacher.name ?? ""} phone={profile?.phone ?? ""} />
      </section>
      <section aria-labelledby="account" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 id="account" className="type-h3">Account</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all text-brown">{teacher.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="text-brown">Teacher (academy administrator)</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          The teacher role can only be granted or removed by the site administrator with the trusted command-line tool
          (<code>npm run set-role</code>); it cannot be changed from the website. To change your password, sign out and use
          “Forgot password” on the sign-in page.
        </p>
        <LogoutButton variant="outline" className="self-start" />
      </section>
    </div>
  );
}

export default function TeacherSettingsPage() {
  return (
    <>
      <TeacherPageHeader title="Settings" />
      <Suspense fallback={<LoadingState label="Loading settings…" />}>
        <Settings />
      </Suspense>
    </>
  );
}

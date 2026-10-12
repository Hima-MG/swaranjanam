import { TeacherNav } from "@/components/lms/teacher/teacher-nav";

// Teacher (academy admin) area: sidebar + content. The layout reads no
// session data, so it stays in the static shell; every page verifies the
// teacher role on the server inside its own Suspense boundary.
export default function TeacherLayout({ children }: LayoutProps<"/teacher">) {
  return (
    <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-10">
      <TeacherNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

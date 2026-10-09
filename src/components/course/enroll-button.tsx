"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

// Placeholder until online payments are implemented in a later phase.
export function EnrollButton({ courseTitle }: { courseTitle: string }) {
  return (
    <Modal
      title="Enrollment opening soon"
      description={`Online enrollment for ${courseTitle} will be available shortly.`}
      trigger={
        <Button size="lg" className="w-full">
          Enroll Now
        </Button>
      }
      footer={
        <Button asChild>
          <Link href="/contact">Contact the academy</Link>
        </Button>
      }
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        In the meantime, reach out to us and we will help you reserve a seat in the next
        batch and answer any questions about the course.
      </p>
    </Modal>
  );
}

"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (choose "Save as PDF" to download). */
export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return (
    <Button type="button" onClick={() => window.print()} className="print:hidden">
      <Printer data-icon="inline-start" />
      {label}
    </Button>
  );
}

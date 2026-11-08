"use client";

import { updateCourseProgramme } from "@/app/(account)/teacher/programme-actions";
import { FormAlert } from "@/components/forms/form-alert";
import { useServerAction } from "@/components/lms/use-server-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/loading-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PROGRAMME_STATUS_LABELS,
  PROGRAMME_STATUSES,
  PROGRAMME_TYPE_LABELS,
  PROGRAMME_TYPES,
  sessionLines,
  type ProgrammeInfo,
} from "@/lib/lms/programme";

function Err({ message }: { message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/** Special Programme settings. Name, description and category are the course's own (Course details / Catalogue). */
export function ProgrammeForm({ courseId, programme }: { courseId: string; programme: ProgrammeInfo | null }) {
  const { pending, error, fieldErrors: e, success, run } = useServerAction();
  const p = programme;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const d = new FormData(event.currentTarget);
        const v = (k: string) => String(d.get(k) ?? "");
        run(
          () =>
            updateCourseProgramme(courseId, {
              programmeType: v("programmeType"),
              status: v("status"),
              fee: v("fee"),
              durationText: v("durationText"),
              startDate: v("startDate"),
              endDate: v("endDate"),
              maxParticipants: v("maxParticipants"),
              sessions: v("sessions"),
              materials: v("materials"),
              recordingsAvailable: d.get("recordingsAvailable") === "on",
            }),
          { success: "Programme saved." },
        );
      }}
    >
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-type">Programme type</Label>
          <NativeSelect id="pg-type" name="programmeType" defaultValue={p?.programmeType ?? "workshop"}>
            {PROGRAMME_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROGRAMME_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
          <Err message={e.programmeType} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-status">Status</Label>
          <NativeSelect id="pg-status" name="status" defaultValue={p?.status ?? "draft"}>
            {PROGRAMME_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROGRAMME_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          <Err message={e.status} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-fee">Total fee (₹)</Label>
          <Input id="pg-fee" name="fee" inputMode="decimal" required defaultValue={p ? String(p.feeMinor / 100) : ""} />
          <Err message={e.fee} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-duration">Duration (optional)</Label>
          <Input id="pg-duration" name="durationText" maxLength={80} placeholder="e.g. 4 weeks" defaultValue={p?.durationText ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-start">Start date</Label>
          <Input id="pg-start" name="startDate" type="date" required defaultValue={p?.startDate ?? ""} />
          <Err message={e.startDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-end">End date</Label>
          <Input id="pg-end" name="endDate" type="date" required defaultValue={p?.endDate ?? ""} />
          <Err message={e.endDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pg-max">Maximum participants (optional)</Label>
          <Input id="pg-max" name="maxParticipants" inputMode="numeric" defaultValue={p?.maxParticipants ?? ""} />
          <Err message={e.maxParticipants} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm text-brown">
          <input type="checkbox" name="recordingsAvailable" defaultChecked={p?.recordingsAvailable ?? false} className="size-4 accent-maroon" />
          Session recordings will be available to participants
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="pg-sessions">Session dates and times (IST) — one per line</Label>
          <Textarea id="pg-sessions" name="sessions" rows={5} defaultValue={p ? sessionLines(p.sessions) : ""} placeholder={"2026-12-05 18:00-19:00 Introduction\n2026-12-12 18:00-19:00 Second bhajan"} />
          <Err message={e.sessions} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="pg-materials">Learning materials (shown to registered participants)</Label>
          <Textarea id="pg-materials" name="materials" rows={3} maxLength={2000} defaultValue={p?.materials ?? ""} />
        </div>
      </fieldset>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {success && <FormAlert tone="success">{success}</FormAlert>}
      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Spinner className="size-4 text-cream" />}
        {p ? "Save programme" : "Make this a Special Programme"}
      </Button>
    </form>
  );
}

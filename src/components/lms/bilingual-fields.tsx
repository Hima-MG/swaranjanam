import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS } from "@/lib/lms/validation";

export interface BilingualValues {
  title: string;
  titleMl: string;
  description: string;
  descriptionMl: string;
}

export const EMPTY_BILINGUAL: BilingualValues = { title: "", titleMl: "", description: "", descriptionMl: "" };

/** Reads the four bilingual fields from a submitted form. */
export function readBilingualForm(form: HTMLFormElement): BilingualValues {
  const data = new FormData(form);
  return {
    title: String(data.get("title") ?? ""),
    titleMl: String(data.get("titleMl") ?? ""),
    description: String(data.get("description") ?? ""),
    descriptionMl: String(data.get("descriptionMl") ?? ""),
  };
}

function Field({
  id,
  name,
  label,
  defaultValue,
  error,
  multiline,
  lang,
  required,
}: {
  id: string;
  name: keyof BilingualValues;
  label: string;
  defaultValue: string;
  error?: string;
  multiline?: boolean;
  lang: "en" | "ml";
  required?: boolean;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const common = {
    id,
    name,
    defaultValue,
    lang,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": errorId,
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
        {required && <span className="text-maroon"> *</span>}
      </Label>
      {multiline ? (
        <Textarea {...common} maxLength={LIMITS.description} rows={4} />
      ) : (
        <Input {...common} maxLength={LIMITS.title} required={required} />
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * English and Malayalam versions side by side. English title is required;
 * Malayalam is optional and is never auto-filled from English.
 */
export function BilingualFields({
  idPrefix,
  defaults = EMPTY_BILINGUAL,
  errors = {},
  descriptionLabel = "Description",
}: {
  idPrefix: string;
  defaults?: BilingualValues;
  errors?: Record<string, string>;
  descriptionLabel?: string;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <fieldset className="flex flex-col gap-4 rounded-xl border border-border bg-ivory/60 p-4">
        <legend className="px-1 text-xs font-semibold tracking-wide text-brown-muted uppercase">English</legend>
        <Field id={`${idPrefix}-title`} name="title" label="Title" defaultValue={defaults.title} error={errors.title} lang="en" required />
        <Field
          id={`${idPrefix}-description`}
          name="description"
          label={descriptionLabel}
          defaultValue={defaults.description}
          error={errors.description}
          lang="en"
          multiline
        />
      </fieldset>
      <fieldset className="flex flex-col gap-4 rounded-xl border border-border bg-ivory/60 p-4">
        <legend className="px-1 text-xs font-semibold tracking-wide text-brown-muted" lang="ml">
          മലയാളം <span lang="en" className="font-normal normal-case">(Malayalam, optional)</span>
        </legend>
        <Field id={`${idPrefix}-titleMl`} name="titleMl" label="Title (Malayalam)" defaultValue={defaults.titleMl} error={errors.titleMl} lang="ml" />
        <Field
          id={`${idPrefix}-descriptionMl`}
          name="descriptionMl"
          label={`${descriptionLabel} (Malayalam)`}
          defaultValue={defaults.descriptionMl}
          error={errors.descriptionMl}
          lang="ml"
          multiline
        />
      </fieldset>
    </div>
  );
}

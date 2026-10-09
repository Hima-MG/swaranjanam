import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends React.ComponentProps<typeof Input> {
  id: string;
  label: string;
  hint?: string;
}

/** Labelled input. Pass `children` to render a custom control instead of an Input. */
export function FormField({ id, label, hint, className, children, ...inputProps }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      {children ?? <Input id={id} name={id} aria-describedby={hintId} {...inputProps} />}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

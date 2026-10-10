"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface PasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, "type"> {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Labelled password input with a show/hide toggle inside the field.
 * Hidden by default; the toggle is a real button (type="button", so it never
 * submits) with an accessible name that reflects its action.
 */
export function PasswordField({ id, label, hint, className, disabled, ...inputProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id} className="text-sm font-medium text-brown">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          aria-describedby={hintId}
          disabled={disabled}
          className="pr-12"
          // Stop browsers from offering autocorrect/capitalisation on visible passwords.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-brown-muted transition-colors outline-none hover:text-maroon focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {visible ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

import type { InputHTMLAttributes } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
}

export function FormField({ label, name, error, id, ...inputProps }: FormFieldProps) {
  const fieldId = id ?? name;
  const errorId = `${fieldId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="text-app-muted text-xs font-semibold tracking-wide uppercase"
      >
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className="border-app-line bg-app-bg text-app-fg focus-visible:border-app-fg rounded-lg border px-3.5 py-2.5 text-sm outline-none"
        {...inputProps}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

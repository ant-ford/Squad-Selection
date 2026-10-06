import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/** What Field hands its control so the label, hint and error are announced with it. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

/** The hint and error ids, worked out from the control's id. */
function fieldIds(id: string, { hint, error }: { hint?: boolean; error?: boolean }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

/**
 * A labelled form control: label, the control, an optional hint and an
 * optional error, wired together:
 *
 *  - <label htmlFor> points at the control's id (from `id`, or generated),
 *  - aria-describedby lists the hint and the error,
 *  - aria-invalid is set while there is an error (Input turns its border red),
 *  - `required` shows an asterisk and sets aria-required. It does not add the
 *    native `required` attribute; put that on the control if the browser
 *    should block the submit too.
 *
 * Children: one element (Input, a <select className={inputClass}>, a
 * Textarea...), which gets the props above merged in; or a function that
 * receives them, for controls that need them placed somewhere specific.
 *
 *   <Field label="Shirt number" hint="1 to 99" error={err} required>
 *     <Input inputMode="numeric" value={n} onChange={...} />
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  id: idProp,
  className = '',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown under the control in the danger colour; also sets aria-invalid. */
  error?: ReactNode;
  required?: boolean;
  /** The control's id. Generated when left out. */
  id?: string;
  className?: string;
  children: ReactElement<Partial<FieldControlProps>> | ((control: FieldControlProps) => ReactNode);
}) {
  const generated = useId();
  const id = idProp ?? generated;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const { hintId, errorId, describedBy } = fieldIds(id, { hint: !!hint, error: hasError });

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': hasError ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  let rendered: ReactNode;
  if (typeof children === 'function') {
    rendered = children(control);
  } else if (isValidElement(children)) {
    // Keep any aria-describedby the control already had (e.g. a counter).
    const own = children.props['aria-describedby'];
    rendered = cloneElement(children, {
      ...control,
      'aria-describedby': [own, describedBy].filter(Boolean).join(' ') || undefined,
    });
  } else {
    rendered = children;
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {rendered}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-xs font-medium text-danger-soft-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

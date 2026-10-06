import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * The one text-input look, from the class string pasted into kitUi,
 * ProfileFields, PhoneInput, VolunteeringSection, ApplicantSheet,
 * CommitmentReview, Umpiring, Volunteers and Waivers. Changes from that
 * string: 40 px tall (was 36), 16 px text on phones so iOS does not zoom
 * the page on focus (14 px from the sm breakpoint up, as before), a
 * placeholder colour, a disabled look, and a danger border when
 * aria-invalid is set (Field sets it).
 *
 * `inputClass` is exported for <select> and other controls that should match.
 */
export const inputClass =
  'w-full h-10 rounded-md border border-border bg-background px-3 text-base sm:text-sm text-foreground ' +
  'placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', type = 'text', ...props },
  ref,
) {
  return <input ref={ref} type={type} className={`${inputClass} ${className}`} {...props} />;
});

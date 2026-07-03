import React from 'react';

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  return (
    <textarea
      className="w-full border rounded p-2"
      {...props}
    />
  );
}
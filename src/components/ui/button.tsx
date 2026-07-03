import React from 'react';

type Props =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  };

export function Button({
  className = '',
  ...props
}: Props) {
  return (
    <button
      className={`px-3 py-2 rounded border ${className}`}
      {...props}
    />
  );
}
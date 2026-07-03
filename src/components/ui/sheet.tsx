import React from 'react';

export function Sheet({
  children
}: any) {
  return <>{children}</>;
}

export function SheetContent({
  children
}: any) {
  return (
    <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l p-4 overflow-auto">
      {children}
    </div>
  );
}

export function SheetHeader({
  children
}: any) {
  return <div className="mb-4">{children}</div>;
}

export function SheetTitle({
  children
}: any) {
  return (
    <h2 className="font-semibold text-lg">
      {children}
    </h2>
  );
}
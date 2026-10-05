/**
 * Hands CSV text to the browser as a download. A byte-order mark goes first
 * so Excel reads the file as UTF-8.
 */
export function saveCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // After the click has been handled; revoking synchronously can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

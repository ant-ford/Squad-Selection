import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { uploadDetailsFile } from '@/api/details';

/** Images are shrunk to at most this many pixels on the longer side before upload. */
const MAX_SIDE = 1600;

/** Reads a file as a data URL; images are shrunk and sent as JPEG, PDFs as they are. */
async function prepare(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Upload (or replace) their photo or a copy of their HKID. The photo shows
 * as a preview; the HKID copy only says one is on file.
 */
export default function FileUpload({
  kind,
  label,
  hint,
  currentUrl,
  hasFile,
  onUploaded,
}: {
  kind: 'photo' | 'hkid';
  label: string;
  hint?: string;
  currentUrl?: string | null;
  hasFile: boolean;
  onUploaded: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await uploadDetailsFile(kind, await prepare(file));
      toast.success(kind === 'photo' ? 'Photo saved' : 'HKID copy saved');
      onUploaded(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't upload that file. Try another, or try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      {kind === 'photo' && (
        <div className="h-16 w-16 shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center">
          {currentUrl ? <img src={currentUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">No photo</span>}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {kind === 'hkid' && <p className="text-[11px] text-muted-foreground">{hasFile ? 'A copy is on file.' : 'None on file yet.'}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept={kind === 'photo' ? 'image/*' : 'image/*,application/pdf'}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        {busy ? 'Uploading…' : hasFile ? 'Replace' : 'Upload'}
      </button>
    </div>
  );
}

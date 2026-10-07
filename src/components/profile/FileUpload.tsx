import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, FileText, Upload } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { uploadDetailsFile } from '@/api/details';

/** Images are shrunk to at most this many pixels on the longer side before upload. */
const MAX_SIDE = 1600;

/** A photo's thumbnail is this many pixels on the shorter side: the lists' avatars (36-48 px) at 2-3x. */
const THUMB_SIDE = 128;

/** The bitmap drawn at `scale`, as a data URL of `type`. */
function drawn(bitmap: ImageBitmap, scale: number, type: string, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

/**
 * Reads a file as a data URL; images are shrunk and sent as JPEG, PDFs as
 * they are. With `thumb`, also a 128 px WebP thumbnail (JPEG where the
 * browser can't write WebP), which the Worker keeps for the avatars.
 */
async function prepare(file: File, thumb = false): Promise<{ dataUrl: string; thumbDataUrl?: string }> {
  if (file.type === 'application/pdf') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ dataUrl: String(r.result) });
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  const dataUrl = drawn(bitmap, Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height)), 'image/jpeg', 0.85);
  if (!thumb) return { dataUrl };
  const small = Math.min(1, THUMB_SIDE / Math.min(bitmap.width, bitmap.height));
  const webp = drawn(bitmap, small, 'image/webp', 0.8);
  return { dataUrl, thumbDataUrl: webp.startsWith('data:image/webp') ? webp : drawn(bitmap, small, 'image/jpeg', 0.8) };
}

/**
 * Upload (or replace) a photo or a document (HKID, certificate). What they
 * pick shows straight away as a thumbnail, with a tick once it's saved; a
 * document already on file says so. `upload` sends it somewhere other than
 * the person's own photo or HKID (a family member's).
 */
export default function FileUpload({
  kind,
  label,
  hint,
  currentUrl,
  hasFile,
  onUploaded,
  onSaved,
  upload,
}: {
  kind: 'photo' | 'hkid' | 'passport' | 'document';
  label: string;
  hint?: string;
  currentUrl?: string | null;
  hasFile: boolean;
  onUploaded: (url: string | null) => void;
  /** The file as uploaded, once it's saved (the Personal step reads an ID picture from it). */
  onSaved?: (dataUrl: string) => void;
  upload?: (dataUrl: string) => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // What they picked this visit: an image's thumbnail (or a PDF's name), and whether it saved.
  const [picked, setPicked] = useState<{ thumb: string | null; name: string; saved: boolean } | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      // Their own photo goes with a thumbnail for the lists (ranking, membership boards).
      const { dataUrl, thumbDataUrl } = await prepare(file, kind === 'photo' && !upload);
      setPicked({ thumb: dataUrl.startsWith('data:image/') ? dataUrl : null, name: file.name, saved: false });
      if (upload) {
        await upload(dataUrl);
        onUploaded(null);
      } else {
        const { url } = await uploadDetailsFile(kind === 'document' ? 'hkid' : kind, dataUrl, thumbDataUrl);
        onUploaded(url);
      }
      onSaved?.(dataUrl);
      setPicked((p) => (p ? { ...p, saved: true } : p));
      toast.success(`${label} saved`);
    } catch (err) {
      setPicked(null);
      toast.error(err instanceof ApiError ? err.message : "Couldn't upload that file. Try another, or try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex items-center gap-3 sm:col-span-2">
      {kind === 'photo' && !upload ? (
        <div className="h-16 w-16 shrink-0 rounded-full bg-muted overflow-hidden flex items-center justify-center">
          {picked?.thumb || currentUrl ? (
            <img src={picked?.thumb ?? currentUrl!} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground">No photo</span>
          )}
        </div>
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {picked?.thumb ? <img src={picked.thumb} alt="" className="h-full w-full object-cover" /> : <FileText className={`h-6 w-6 ${hasFile ? 'text-primary' : 'text-muted-foreground'}`} />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {picked?.saved ? (
          <p className="text-xs text-primary flex items-center gap-1 truncate">
            <Check className="h-3.5 w-3.5 shrink-0" /> Uploaded: {picked.name}
          </p>
        ) : hasFile ? (
          <p className="text-xs text-primary flex items-center gap-1">
            <Check className="h-3.5 w-3.5 shrink-0" /> On file
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Not uploaded yet</p>
        )}
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

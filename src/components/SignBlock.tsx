import { useState } from 'react';
import SignaturePad from '@/components/SignaturePad';

/** Sign with the saved signature in one tap, or draw one (it is kept for next time). */
export default function SignBlock({ savedUrl, onChange }: { savedUrl: string | null | undefined; onChange: (png: string | null | 'saved') => void }) {
  const [redraw, setRedraw] = useState(!savedUrl);
  if (savedUrl && !redraw) {
    return (
      <div>
        <p className="text-xs text-muted-foreground mb-1">Signed with your saved signature</p>
        <img src={savedUrl} alt="Your saved signature" className="h-20 rounded-md border border-border bg-white object-contain" />
        <button
          type="button"
          className="block text-xs text-primary hover:underline mt-1"
          onClick={() => {
            setRedraw(true);
            onChange(null);
          }}
        >
          Sign again instead
        </button>
      </div>
    );
  }
  return <SignaturePad onChange={onChange} />;
}

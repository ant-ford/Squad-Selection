import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import { deleteMyProfile } from '@/api/details';
import { signOut } from '@/lib/auth';
import { ApiError } from '@/lib/apiClient';

/**
 * "Delete my profile" (owner, 2026-10-02): removes their personal details,
 * files and sign-in now, the same as the 13-month retention removal. Their
 * name and playing record stay. Typing DELETE guards against a slip.
 */
export default function DeleteProfile() {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: deleteMyProfile,
    onSuccess: async () => {
      toast.success('Your profile has been deleted');
      await signOut().catch(() => {});
      window.location.assign('/');
    },
    onError: (err) => {
      setAsking(false);
      toast.error(err instanceof ApiError && err.status < 500 ? err.message : 'Your profile could not be deleted. Try again.');
    },
  });
  return (
    <section className="mt-8 border-t border-border pt-4 space-y-2">
      <p className="text-sm font-medium text-foreground">Delete my profile</p>
      <p className="text-xs text-muted-foreground">
        Removes your contact, ID and bank details, family, photos and documents, availability and sign-in straight away. Your name stays
        in past match results and stats. If you've had enough of hockey for now, you can instead say you're not playing this season
        under Hockey.
      </p>
      <button onClick={() => setAsking(true)} className="text-sm text-destructive underline">
        Delete my profile
      </button>
      {asking && (
        <ConfirmDialog
          title="Delete your profile?"
          message="This can't be undone. You'll be signed out, and if you come back to the club you'll need to fill in your details again. Any role you hold as an officer, coach or captain ends."
          confirmLabel={remove.isPending ? 'Deleting…' : 'Delete my profile'}
          destructive
          typeToConfirm="DELETE"
          busy={remove.isPending}
          onCancel={() => !remove.isPending && setAsking(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
    </section>
  );
}

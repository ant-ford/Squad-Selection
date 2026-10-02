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
 * name and playing record stay. Typing DELETE guards against a slip. Shown
 * only at the bottom of the Membership step, as a red button.
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
    <section className="flex justify-end pt-2">
      <button
        onClick={() => setAsking(true)}
        className="h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90"
      >
        Delete my profile
      </button>
      {asking && (
        <ConfirmDialog
          title="Delete your profile?"
          message="This removes your contact, ID and bank details, family, photos, documents, availability and sign-in straight away, and ends any officer, coach or captain role. Your name stays in past results and stats. It can't be undone."
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

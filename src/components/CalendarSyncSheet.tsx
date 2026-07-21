import CalendarSheet from "@/components/CalendarSheet";
import { apiGet } from "@/lib/apiClient";
import { useAuth } from "@/lib/useAuth";

export default function CalendarSyncSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const email = user?.email;

  const fetchLink = async () => {
    if (!email) throw new Error("Not authenticated");
    const link = await apiGet<{ id: string; sig: string }>("/api/calendar/link", { email });
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const baseUrl = apiUrl.startsWith("http") ? apiUrl : `http://${apiUrl}`;
    return { url: `${baseUrl}/api/calendar/feed.ics?id=${link.id}&sig=${link.sig}` };
  };

  return <CalendarSheet fetchLink={fetchLink} onClose={onClose} />;
}
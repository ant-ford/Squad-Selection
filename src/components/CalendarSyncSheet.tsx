import CalendarSheet from "@/components/CalendarSheet";
import { apiGet } from "@/lib/apiClient";

export default function CalendarSyncSheet({ onClose }: { onClose: () => void }) {
  const fetchLink = async () => {
    // The Worker derives the player identity from the session, and returns
    // the full feed URL directly - it already knows its own public origin.
    return apiGet<{ url: string }>("/api/calendar/link");
  };

  return <CalendarSheet fetchLink={fetchLink} onClose={onClose} />;
}
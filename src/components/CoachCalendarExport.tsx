import CalendarSheet from "@/components/CalendarSheet";
import { apiGet } from "@/lib/apiClient";
import { useAuth } from "@/lib/useAuth";

export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  const { user } = useAuth();
  const email = user?.email;

  if (!activeTab || activeTab === "all" || !email) return null;

  const fetchLink = async () => {
    const link = await apiGet<{ team: string; sig: string }>("/api/calendar/team-link", {
      email,
      team: activeTab,
    });
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const baseUrl = apiUrl.startsWith("http") ? apiUrl : `http://${apiUrl}`;
    return { url: `${baseUrl}/api/calendar/team-feed.ics?team=${link.team}&sig=${link.sig}` };
  };

  return (
    <CalendarSheet
      fetchLink={fetchLink}
      inline
      generateLabel="Subscribe to Team Calendar"
    />
  );
}
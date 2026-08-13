import CalendarSheet from "@/components/CalendarSheet";
import { apiGet } from "@/lib/apiClient";

export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  if (!activeTab || activeTab === "all") return null;

  const fetchLink = async () => {
    // The Worker verifies coach access from the session; `team` is the only
    // client-supplied parameter and it identifies the team, not the user.
    const link = await apiGet<{ team: string; sig: string }>("/api/calendar/team-link", {
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
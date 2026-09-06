import CalendarSheet from "@/components/CalendarSheet";
import { apiGet } from "@/lib/apiClient";

export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  if (!activeTab || activeTab === "all") return null;

  const fetchLink = async () => {
    // The Worker verifies coach access from the session; `team` is the only
    // client-supplied parameter and it identifies the team, not the user. It
    // returns the full feed URL directly - it already knows its own public origin.
    return apiGet<{ url: string }>("/api/calendar/team-link", { team: activeTab });
  };

  return (
    <CalendarSheet
      fetchLink={fetchLink}
      inline
      generateLabel="Subscribe to Team Calendar"
    />
  );
}
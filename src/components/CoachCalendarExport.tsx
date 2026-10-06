import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import CalendarSheet from "@/components/CalendarSheet";
import { ActionButton } from "@/components/ui/action-button";
import { apiGet } from "@/lib/apiClient";

/**
 * The team calendar for the selected tab: an icon button in the fixture
 * list's toolbar that opens the calendar sheet. It used to be a wide
 * "Subscribe to Team Calendar" button in the toolbar itself, which squeezed
 * the team tabs out of sight on a phone.
 */
export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  const [open, setOpen] = useState(false);
  if (!activeTab || activeTab === "all") return null;

  const fetchLink = async () => {
    // The Worker verifies coach access from the session; `team` is the only
    // client-supplied parameter and it identifies the team, not the user. It
    // returns the full feed URL directly - it already knows its own public origin.
    return apiGet<{ url: string }>("/api/calendar/team-link", { team: activeTab });
  };

  return (
    <>
      <ActionButton
        variant="ghost"
        iconOnly
        icon={<CalendarPlus />}
        aria-label={`${activeTab} calendar`}
        title={`${activeTab} calendar`}
        onClick={() => setOpen(true)}
      />
      {open && (
        <CalendarSheet
          fetchLink={fetchLink}
          title={`${activeTab} calendar`}
          description={`${activeTab}'s fixtures in your calendar app, kept up to date.`}
          generateLabel="Get calendar link"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

import { useQuery } from "@tanstack/react-query";
import { PlaneTakeoff } from "lucide-react";
import { departuresQueryOptions, type Departure } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatNumber } from "../../lib/format";
import { useClock } from "../../shell/useClock";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { cn } from "../../ui/cn";
import { daysUntil, localDateIn, routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";
import { LoadingPanel } from "./panelParts";

const TITLE = "Upcoming departures";
/** Icon chip in the card head. */
const ICON = PlaneTakeoff;
const DESCRIPTION = "Won trips by departure date, agency time";

function countdown(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${formatNumber(days)} days`;
}

export function DeparturesPanel({ onNewEnquiry, className }: { onNewEnquiry: () => void; className?: string }) {
  const me = useCurrentUser();
  const departures = useQuery(departuresQueryOptions);
  const now = useClock(60_000);
  const today = localDateIn(now, me?.agency.timezone ?? "UTC");

  if (departures.isPending) return <LoadingPanel title={TITLE} icon={ICON} description={DESCRIPTION} rows={3} className={className} />;
  if (departures.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        icon={ICON}
        description={DESCRIPTION}
        error={departures.error}
        onRetry={() => void departures.refetch()}
        retrying={departures.isFetching}
        className={className}
      />
    );
  }

  const columns: DataTableColumn<Departure>[] = [
    {
      key: "departs",
      header: "Departs",
      className: "pl-4",
      sortValue: (row) => row.depart_date,
      cell: (row) => {
        const days = daysUntil(row.depart_date, today);
        return (
          <span className="flex flex-col">
            <span className="whitespace-nowrap font-mono tabular-nums">{formatDate(row.depart_date)}</span>
            <span className={cn("whitespace-nowrap text-[11px] leading-4", days <= 3 ? "text-warn" : "text-faint")}>{countdown(days)}</span>
          </span>
        );
      },
    },
    {
      key: "enquiry",
      header: "Enquiry",
      sortValue: (row) => row.number,
      cell: (row) => <span className="font-mono text-dim">{row.number}</span>,
    },
    {
      key: "client",
      header: "Client",
      sortValue: (row) => row.client ?? "",
      cell: (row) => (row.client ? row.client : <span className="text-faint">No client</span>),
    },
    {
      key: "route",
      header: "Route",
      cell: (row) => <span className="whitespace-nowrap font-mono">{routeLabel(row.origin, row.destination)}</span>,
    },
    {
      key: "travellers",
      header: "Travellers",
      align: "right",
      className: "pr-4",
      sortValue: (row) => row.travellers,
      cell: (row) => formatNumber(row.travellers),
    },
  ];

  return (
    <Panel title={TITLE} icon={ICON} description={DESCRIPTION} flush className={cn("flex flex-col", className)}>
      <DataTable
        caption={TITLE}
        columns={columns}
        rows={departures.data.items}
        getRowId={(row) => row.enquiry_id}
        initialSort={{ key: "departs", direction: "asc" }}
        className="max-h-96 min-h-0 flex-1 border-t border-line"
        emptyState={
          <EmptyState
            icon={PlaneTakeoff}
            title="No upcoming departures"
            description="Won trips with upcoming departures show here."
            action={{ label: "Create enquiry", onClick: onNewEnquiry }}
          />
        }
      />
    </Panel>
  );
}

import { useQuery } from "@tanstack/react-query";
import { PlaneTakeoff } from "lucide-react";
import { departuresQueryOptions, type Departure } from "../../api/dashboard";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { formatDate, formatNumber } from "../../lib/format";
import { useClock } from "../../shell/useClock";
import { DataTable, type DataTableColumn } from "../../ui/DataTable";
import { EmptyState } from "../../ui/EmptyState";
import { Panel } from "../../ui/Panel";
import { PanelSkeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/cn";
import { daysUntil, localDateIn, routeLabel } from "./format";
import { ErrorPanel } from "./PanelError";

const TITLE = "Upcoming departures";
const EYEBROW = "Won trips";

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

  if (departures.isPending) return <PanelSkeleton title={TITLE} eyebrow={EYEBROW} className={className} />;
  if (departures.isError) {
    return (
      <ErrorPanel
        title={TITLE}
        eyebrow={EYEBROW}
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
      sortValue: (row) => row.depart_date,
      cell: (row) => {
        const days = daysUntil(row.depart_date, today);
        return (
          <span className="flex flex-col">
            <span className="whitespace-nowrap font-mono tabular-nums">{formatDate(row.depart_date)}</span>
            <span className={cn("text-[11px]", days <= 3 ? "text-warn" : "text-dim")}>{countdown(days)}</span>
          </span>
        );
      },
    },
    {
      key: "client",
      header: "Client",
      sortValue: (row) => row.client ?? "",
      cell: (row) => (row.client ? row.client : <span className="text-dim">No client</span>),
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
      sortValue: (row) => row.travellers,
      cell: (row) => formatNumber(row.travellers),
    },
    {
      key: "enquiry",
      header: "Enquiry",
      sortValue: (row) => row.number,
      cell: (row) => <span className="font-mono text-primary">{row.number}</span>,
    },
  ];

  return (
    <Panel variant="glass" title={TITLE} eyebrow={EYEBROW} className={className}>
      <DataTable
        caption={TITLE}
        columns={columns}
        rows={departures.data.items}
        getRowId={(row) => row.enquiry_id}
        initialSort={{ key: "departs", direction: "asc" }}
        className="max-h-96"
        emptyState={
          <EmptyState
            icon={PlaneTakeoff}
            title="No upcoming departures"
            description="Won trips with upcoming departures show here."
            action={{ label: "Create an enquiry", onClick: onNewEnquiry }}
          />
        }
      />
    </Panel>
  );
}

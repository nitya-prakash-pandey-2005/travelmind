import { ChevronDown } from "lucide-react";
import { Avatar } from "../../ui/Avatar";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { cn } from "../../ui/cn";
import { StatusPill, type EnquiryStatus } from "../../ui/StatusPill";
import {
  ALL_SAMPLE_FARES,
  FareInsightCard,
  FareTable,
  KpiStrip,
  MiniPanel,
  PipelineStages,
  PreviewWindow,
  ScreenHeader,
  SourceChips,
  TrendChart,
} from "./ConsolePreview";

/** Product tour screens. Sample data throughout; the tour captions every screen as an illustration. */

const ACTIVITY = [
  {
    who: "Asha Rao",
    what: "created enquiry E-0142",
    detail: "Mehta family · DEL → LHR",
    when: "2 min ago",
  },
  {
    who: "Kabir Shah",
    what: "searched BOM → SIN",
    detail: "6 fares from 2 sources",
    when: "5 min ago",
  },
  {
    who: "Meera Iyer",
    what: "moved E-0138 to Quoted",
    detail: "Iyer · DEL → DXB",
    when: "12 min ago",
  },
  {
    who: "Rohan Das",
    what: "joined the workspace",
    detail: "Agent",
    when: "1 h ago",
  },
];

const HEALTH = [
  { name: "Duffel", p50: "412 ms", p50Width: "34%", p95Width: "68%" },
  { name: "LiteAPI", p50: "655 ms", p50Width: "46%", p95Width: "88%" },
  { name: "Fare cache", p50: "12 ms", p50Width: "4%", p95Width: "9%" },
];

function ActivityList() {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {ACTIVITY.map((item) => (
        <li key={item.what} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
          <Avatar name={item.who} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] text-ink">
              {item.who.split(" ")[0]} {item.what}
            </span>
            <span className="block truncate text-[10px] text-faint">{item.detail}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-faint">{item.when}</span>
        </li>
      ))}
    </ul>
  );
}

function SupplierHealth() {
  return (
    <>
      <ul className="flex flex-col gap-3">
        {HEALTH.map((row) => (
          <li key={row.name} className="grid grid-cols-[5.25rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 whitespace-nowrap font-mono text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {row.name}
            </span>
            <span className="relative h-1.5 rounded-full bg-chart-grid">
              <span className="absolute inset-y-0 left-0 rounded-full bg-chart-1/35" style={{ width: row.p95Width }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-chart-1" style={{ width: row.p50Width }} />
            </span>
            <span className="text-right font-mono text-dim">{row.p50}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line text-[10px]">
        {[
          ["Calls, 24h", "1,284"],
          ["Errors", "0.4%"],
          ["Timeouts", "3"],
        ].map(([label, value]) => (
          <div key={label} className="bg-bg px-2 py-1.5">
            <dt className="text-faint">{label}</dt>
            <dd className="font-mono text-xs text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function CommandCenterScreen() {
  return (
    <PreviewWindow active="Command Center" sidebar="xl">
      <ScreenHeader crumb="Operate / Command Center" title="Command Center" meta="Example Travels · last 30 days" action="New enquiry" />
      <KpiStrip count={5} className="mt-3" />
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <MiniPanel title="Enquiries per day" aside={<span className="font-mono text-[10px] text-ok">+18% vs prev. 30 days</span>}>
          <TrendChart className="h-28" />
        </MiniPanel>
        <MiniPanel title="Pipeline" aside={<span className="font-mono text-[10px] text-faint">24 open</span>}>
          <PipelineStages />
        </MiniPanel>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <MiniPanel title="Live activity" aside={<Badge tone="ok">Live</Badge>}>
          <ActivityList />
        </MiniPanel>
        <MiniPanel
          title="Supplier health"
          aside={<span className="font-mono text-[10px] text-faint">p50 · p95, 24h</span>}
          className="max-md:hidden"
        >
          <SupplierHealth />
        </MiniPanel>
      </div>
    </PreviewWindow>
  );
}

function Field({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5", className)}>
      <span className="text-[10px] text-faint">{label}</span>
      <span className="truncate text-xs text-ink">
        <span className="font-mono">{value}</span>
        {sub && <span className="text-dim"> {sub}</span>}
      </span>
    </span>
  );
}

export function FareSearchScreen() {
  return (
    <PreviewWindow active="Fare search" sidebar="xl">
      <ScreenHeader crumb="Market / Fare search" title="Fare search" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]">
        <Field label="From" value="DEL" sub="New Delhi" />
        <Field label="To" value="DXB" sub="Dubai" />
        <Field label="Depart" value="14 Nov" className="max-sm:hidden" />
        <Field label="Travellers" value="1" sub="adult · Economy" className="max-sm:hidden" />
        <span className="col-span-2 inline-flex h-full min-h-9 items-center justify-center rounded-md bg-primary bg-(image:--tm-grad) px-3 text-xs font-medium text-primary-ink sm:col-span-1">
          Scan fares
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SourceChips />
        <span className="text-[11px] text-dim">6 results · by departure</span>
      </div>
      <div className="mt-3">
        <FareTable fares={ALL_SAMPLE_FARES} />
      </div>
      <div className="mt-3 grid items-start gap-3 sm:grid-cols-2">
        <FareInsightCard />
        <div className="rounded-[14px] border border-line bg-card-2 p-3">
          <p className="text-[13px] font-semibold text-ink">CO₂ per passenger</p>
          <p className="mt-1 text-xs leading-4 text-dim">Akasa Air emits the least on this route.</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {[
              { code: "QP", kg: 189 },
              { code: "FZ", kg: 192 },
              { code: "6E", kg: 198 },
              { code: "EK", kg: 214 },
            ].map((row) => (
              <li key={row.code} className="grid grid-cols-[1.5rem_minmax(0,1fr)_3rem] items-center gap-2 font-mono text-[10px] text-dim">
                <span>{row.code}</span>
                <span className="h-1.5 rounded-full bg-ok/70" style={{ width: `${((row.kg - 150) / 70) * 100}%` }} />
                <span className="text-right">{row.kg} kg</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-faint">Estimates: Google Travel Impact Model</p>
        </div>
      </div>
    </PreviewWindow>
  );
}

type Enquiry = {
  number: string;
  client: string;
  route: string;
  when: string;
  status: EnquiryStatus;
  owner: string;
};

const ENQUIRIES: Enquiry[] = [
  {
    number: "E-0142",
    client: "Mehta family",
    route: "DEL → LHR",
    when: "12–19 Dec · 4 pax",
    status: "new",
    owner: "Asha Rao",
  },
  {
    number: "E-0139",
    client: "Kapoor & Co.",
    route: "BOM → SIN",
    when: "3 Nov · 2 pax",
    status: "quoting",
    owner: "Kabir Shah",
  },
  {
    number: "E-0138",
    client: "R. Iyer",
    route: "DEL → DXB",
    when: "14 Nov · 1 pax",
    status: "quoted",
    owner: "Meera Iyer",
  },
  {
    number: "E-0131",
    client: "Sharma & Sons",
    route: "BLR → DXB",
    when: "28 Oct · 3 pax",
    status: "won",
    owner: "Asha Rao",
  },
];

export function PipelineScreen() {
  return (
    <PreviewWindow active="Command Center" sidebar="xl">
      <ScreenHeader crumb="Operate / Command Center" title="Pipeline" meta="24 open enquiries · ₹6.2L quoted value" action="New enquiry" />
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <MiniPanel title="By stage" aside={<span className="font-mono text-[10px] text-faint">count · value</span>}>
          <PipelineStages />
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-dim">
            <span className="text-ink">Lost</span> <span className="font-mono">2 enquiries</span> closed without a booking
          </p>
        </MiniPanel>
        <MiniPanel title="Enquiries" aside={<span className="font-mono text-[10px] text-faint">by last update</span>}>
          <ul className="flex flex-col divide-y divide-line">
            {ENQUIRIES.map((enquiry) => (
              <li key={enquiry.number} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 py-2 first:pt-0 last:pb-0">
                <span className="font-mono text-[11px] text-dim">{enquiry.number}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-ink">
                    {enquiry.client} <span className="font-mono text-dim">{enquiry.route}</span>
                  </span>
                  <span className="block truncate text-[10px] text-faint">
                    {enquiry.when} · {enquiry.owner}
                  </span>
                </span>
                <StatusPill status={enquiry.status} />
              </li>
            ))}
          </ul>
        </MiniPanel>
      </div>
      <div className="mt-3 rounded-md border border-dashed border-line-strong bg-card-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink">
            Quote Q-0031 <span className="font-normal text-dim">for E-0142 · Mehta family</span>
          </p>
          <StatusPill status="viewed" />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            {
              label: "Option A",
              detail: "BA 256 · direct",
              price: "₹2,41,800",
            },
            {
              label: "Option B",
              detail: "EK 511 · via DXB",
              price: "₹2,18,400",
            },
            {
              label: "Option C",
              detail: "AI 161 · direct",
              price: "₹2,62,500",
            },
          ].map((option) => (
            <span key={option.label} className="flex min-w-0 flex-col rounded-md border border-line bg-bg px-2.5 py-2">
              <span className="text-[10px] text-faint">{option.label}</span>
              <span className="truncate text-[11px] text-ink">{option.detail}</span>
              <span className="font-mono text-xs tabular-nums text-ink">{option.price}</span>
            </span>
          ))}
        </div>
      </div>
    </PreviewWindow>
  );
}

type Member = {
  name: string;
  email: string;
  role: "owner" | "admin" | "agent";
  you?: boolean;
};

const MEMBERS: Member[] = [
  { name: "Asha Rao", email: "asha@example.com", role: "owner", you: true },
  { name: "Meera Iyer", email: "meera@example.com", role: "admin" },
  { name: "Kabir Shah", email: "kabir@example.com", role: "agent" },
  { name: "Rohan Das", email: "rohan@example.com", role: "agent" },
  { name: "Farah Khan", email: "farah@example.com", role: "agent" },
];

const ROLE_TONE: Record<Member["role"], BadgeTone> = {
  owner: "primary",
  admin: "info",
  agent: "neutral",
};

export function TeamScreen() {
  return (
    <div className="relative sm:pb-10">
      <PreviewWindow active="Team" sidebar="xl">
        <ScreenHeader crumb="Admin / Team" title="Team" meta="Everyone with access to Example Travels." action="Invite teammate" />
        <div className="mt-3 overflow-hidden rounded-[14px] border border-line bg-card-2">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_4rem] gap-3 border-b border-line px-3 py-2 tm-micro">
            <span>Name</span>
            <span className="max-sm:hidden">Email</span>
            <span>Role</span>
          </div>
          <ul>
            {MEMBERS.map((member) => (
              <li
                key={member.email}
                className="grid h-10 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_4rem] items-center gap-3 border-b border-line px-3 text-xs last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={member.name} size="sm" />
                  <span className="truncate font-medium text-ink">{member.name}</span>
                  {member.you && <Badge tone="ok">You</Badge>}
                </span>
                <span className="truncate text-dim max-sm:hidden">{member.email}</span>
                <Badge tone={ROLE_TONE[member.role]} className="justify-self-start">
                  {member.role}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 rounded-[14px] border border-line bg-card-2 p-3 sm:max-w-[55%]">
          <p className="text-xs font-semibold text-ink">Pending invitations</p>
          <p className="mt-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-ink">priya@example.com</span>
            <Badge tone="neutral">agent</Badge>
          </p>
          <p className="mt-1 font-mono text-[10px] text-faint">Sent 2 days ago · expires in 5 days</p>
          <p className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[11px]">
            <span className="truncate text-ink">dev@example.com</span>
            <Badge tone="info">admin</Badge>
          </p>
          <p className="mt-1 font-mono text-[10px] text-faint">Sent today · expires in 7 days</p>
        </div>
      </PreviewWindow>
      <div className="absolute bottom-0 right-4 z-10 w-72 rounded-[16px] border border-line-soft bg-surface p-4 shadow-pop max-sm:hidden">
        <p className="text-sm font-semibold text-ink">Invite teammate</p>
        <p className="mt-0.5 text-[11px] text-dim">They get a one-time link to join Example Travels.</p>
        <p className="mt-3 text-[11px] font-medium text-ink">Email</p>
        <p className="mt-1 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs text-ink">nisha@example.com</p>
        <p className="mt-2.5 text-[11px] font-medium text-ink">Role</p>
        <p className="mt-1 flex items-center justify-between rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs text-ink">
          Agent <ChevronDown size={13} className="text-faint" />
        </p>
        <p className="mt-1 text-[10px] leading-4 text-dim">Searches fares and hotels and handles enquiries and quotes.</p>
        <div className="mt-3 flex justify-end gap-2">
          <span className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface-2 px-2.5 text-[11px] text-ink">
            Cancel
          </span>
          <span className="inline-flex h-7 items-center rounded-md bg-primary bg-(image:--tm-grad) px-2.5 text-[11px] font-medium text-primary-ink">
            Create invite link
          </span>
        </div>
      </div>
    </div>
  );
}

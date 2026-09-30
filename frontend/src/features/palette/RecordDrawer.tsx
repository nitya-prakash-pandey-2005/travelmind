import type { ReactNode } from "react";
import type { ClientHit, EnquiryHit, QuoteHit } from "../../api/workspace";
import { Drawer } from "../../ui/Drawer";
import { STATUS_PILL, StatusPill, type PillStatus } from "../../ui/StatusPill";

export type RecordSelection =
  | { type: "client"; record: ClientHit }
  | { type: "enquiry"; record: EnquiryHit }
  | { type: "quote"; record: QuoteHit };

function isPillStatus(status: string): status is PillStatus {
  return Object.hasOwn(STATUS_PILL, status);
}

export function Status({ status }: { status: string }) {
  return isPillStatus(status) ? <StatusPill status={status} /> : <span className="text-sm text-ink">{status}</span>;
}

export function formatRoute(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "Route not set";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
      <dt className="tm-micro">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

function describe(selection: RecordSelection): { title: string; kind: string; facts: ReactNode } {
  switch (selection.type) {
    case "client": {
      const { name, email, company_name } = selection.record;
      return {
        title: name,
        kind: "Client",
        facts: (
          <>
            <Fact label="Email">{email ?? "Not recorded"}</Fact>
            <Fact label="Company">{company_name ?? "Not recorded"}</Fact>
          </>
        ),
      };
    }
    case "enquiry": {
      const { number, origin, destination, status } = selection.record;
      return {
        title: number,
        kind: "Enquiry",
        facts: (
          <>
            <Fact label="Route">
              <span className="font-mono">{formatRoute(origin, destination)}</span>
            </Fact>
            <Fact label="Status">
              <Status status={status} />
            </Fact>
          </>
        ),
      };
    }
    case "quote": {
      const { number, status, client_name } = selection.record;
      return {
        title: number,
        kind: "Quote",
        facts: (
          <>
            <Fact label="Status">
              <Status status={status} />
            </Fact>
            <Fact label="Client">{client_name ?? "No client"}</Fact>
          </>
        ),
      };
    }
  }
}

/** A found record at a glance, opened from the command palette. */
export function RecordDrawer({ selection, onClose }: { selection: RecordSelection | null; onClose: () => void }) {
  if (!selection) return null;
  const { title, kind, facts } = describe(selection);
  return (
    <Drawer open onClose={onClose} title={title} description={kind}>
      <dl className="flex flex-col">{facts}</dl>
    </Drawer>
  );
}

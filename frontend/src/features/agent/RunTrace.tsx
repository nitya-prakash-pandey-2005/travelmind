import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  BedDouble,
  CalendarDays,
  ChartLine,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CircleX,
  CloudSun,
  FilePlus2,
  Inbox,
  Landmark,
  LoaderCircle,
  MapPin,
  MessageCircleQuestion,
  MessageSquareText,
  Plane,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  isWorking,
  MAX_AGENT_TEXT,
  type AgentRunDetail,
  type AgentStep,
  type AgentTool,
  type PendingConfirm,
  type PendingQuestion,
  type ToolCallStep,
  type ToolResultStep,
} from "../../api/agent";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { FIELD_CONTROL } from "../../ui/TextField";
import { fieldLabel, formatMs, splitApprox } from "./agentText";
import { ConfirmActionCard } from "./ConfirmActionCard";

export const TOOL_ICON: Record<AgentTool, LucideIcon> = {
  lookup_airport: MapPin,
  search_flights: Plane,
  search_hotels: BedDouble,
  price_check: BadgeCheck,
  fare_insight: ChartLine,
  weather_forecast: CloudSun,
  find_places: Landmark,
  build_itinerary: CalendarDays,
  estimate_budget: Wallet,
  ask_user: MessageCircleQuestion,
  find_client: UserRound,
  create_enquiry: Inbox,
  draft_quote: FilePlus2,
};

type Tone = "dim" | "primary" | "ok" | "warn" | "danger" | "ai";
const TONE: Record<Tone, string> = {
  dim: "text-dim",
  primary: "text-primary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  ai: "text-ai",
};

type TraceItem =
  | { type: "tool"; key: string; call: ToolCallStep | null; result: ToolResultStep | null }
  | { type: "step"; key: string; step: Exclude<AgentStep, ToolCallStep | ToolResultStep> };

/** Steps as rows: a tool call and its result share one row (matched by call_id), everything else is its own. */
export function traceItems(steps: readonly AgentStep[]): TraceItem[] {
  const results = new Map<string, ToolResultStep>();
  const calls = new Set<string>();
  for (const step of steps) {
    if (step.kind === "tool_result") results.set(step.payload.call_id, step);
    if (step.kind === "tool_call") calls.add(step.payload.call_id);
  }
  const items: TraceItem[] = [];
  for (const step of steps) {
    if (step.kind === "tool_call") {
      items.push({ type: "tool", key: `t${step.seq}`, call: step, result: results.get(step.payload.call_id) ?? null });
    } else if (step.kind === "tool_result") {
      if (!calls.has(step.payload.call_id)) items.push({ type: "tool", key: `r${step.seq}`, call: null, result: step });
    } else {
      items.push({ type: "step", key: `s${step.seq}`, step });
    }
  }
  return items;
}

/** A row's state as a kit badge: what it is (or how long it took), in the kit's status tones. */
type RowStatus = { tone: BadgeTone; label: string; live?: boolean };

/**
 * One row of the trace, as a kit list row: the icon chip in the row's tone, the content, and a status badge on
 * the right. `last` is kept for callers; the list's own hairlines separate the rows.
 */
function Row({
  icon: Icon,
  tone = "dim",
  spin = false,
  status,
  action,
  children,
}: {
  icon: LucideIcon;
  tone?: Tone;
  spin?: boolean;
  status?: RowStatus;
  /** A control under the status badge (the details toggle). */
  action?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="li tm-enter items-start gap-3 py-3">
      <span aria-hidden="true" className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-card-2", TONE[tone])}>
        <Icon size={15} strokeWidth={1.75} className={spin ? "tm-spin" : undefined} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
      {(status || action) && (
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          {status && (
            <Badge tone={status.tone} className="px-2 font-mono text-[10.5px]">
              {status.live && <span aria-hidden="true" className="dot tm-live h-1.5! w-1.5!" />}
              {status.label}
            </Badge>
          )}
          {action}
        </div>
      )}
    </li>
  );
}

// --- compact views of tool data --------------------------------------------------------------

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

function MiniTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[18rem] text-left text-xs leading-4">
        <thead>
          <tr className="text-faint [&>th:last-child]:text-right">
            {head.map((label) => (
              <th key={label} scope="col" className="pb-1.5 pr-3 font-medium last:pr-0">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top [&_td]:text-dim [&_td:last-child]:pr-0 [&_td:last-child]:text-right">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function Price({ formatted }: { formatted: unknown }) {
  const { approx, amount } = splitApprox(text(formatted));
  return (
    <span className="tm-num whitespace-nowrap text-ink">
      {approx && <span className="text-dim">≈ </span>}
      {amount}
    </span>
  );
}

function ToolData({ tool, data }: { tool: AgentTool; data: Record<string, unknown> }) {
  const error = data.error as { message?: string } | undefined;
  if (error && typeof error === "object") return <p className="text-xs text-danger">{text(error.message) || "The tool failed."}</p>;
  switch (tool) {
    case "lookup_airport":
      return (
        <MiniTable head={["Code", "Airport", "Country"]}>
          {asArray(data.matches).map((m, index) => (
            <tr key={index}>
              <td><span className="font-mono font-semibold text-ink">{text(m.code)}</span></td>
              <td>
                {text(m.name)}
                {m.city ? <span className="text-faint"> · {text(m.city)}</span> : null}
              </td>
              <td>{text(m.country_code)}</td>
            </tr>
          ))}
        </MiniTable>
      );
    case "search_flights":
      return (
        <MiniTable head={["Option", "Flights", "Stops", "Total"]}>
          {asArray(data.offers).map((o, index) => (
            <tr key={index}>
              <td><span className="font-mono text-ink">{text(o.offer_id)}</span></td>
              <td><span className="font-mono">{(o.flight_numbers as string[] | undefined)?.join(", ")}</span></td>
              <td>{Number(o.stops) === 0 ? "Nonstop" : `${text(o.stops)} stop${Number(o.stops) > 1 ? "s" : ""}`}</td>
              <td><Price formatted={o.total_formatted} /></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "search_hotels":
      return (
        <MiniTable head={["Option", "Hotel", "Per night", "Total"]}>
          {asArray(data.hotels).map((h, index) => (
            <tr key={index}>
              <td><span className="font-mono text-ink">{text(h.hotel_id)}</span></td>
              <td><span className="text-ink">{text(h.name)}</span></td>
              <td><Price formatted={h.per_night_formatted} /></td>
              <td><Price formatted={h.total_formatted} /></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "weather_forecast":
      return (
        <MiniTable head={["Day", "High", "Low", "Rain"]}>
          {asArray(data.days).map((d, index) => (
            <tr key={index}>
              <td>{text(d.date_display)}</td>
              <td><span className="tm-num">{d.temp_max_c === null ? "—" : `${Math.round(Number(d.temp_max_c))}°`}</span></td>
              <td><span className="tm-num">{d.temp_min_c === null ? "—" : `${Math.round(Number(d.temp_min_c))}°`}</span></td>
              <td><span className="tm-num">{d.precipitation_chance_pct === null ? "—" : `${text(d.precipitation_chance_pct)}%`}</span></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "find_places":
      return (
        <MiniTable head={["Place", "Kind", "Distance"]}>
          {asArray(data.places).map((p, index) => (
            <tr key={index}>
              <td><span className="text-ink">{text(p.name)}</span></td>
              <td>{text(p.kind).replace(/_/g, " ")}</td>
              <td><span className="tm-num">{p.distance_km === null || p.distance_km === undefined ? "—" : `${Number(p.distance_km).toFixed(1)} km`}</span></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "estimate_budget":
      return (
        <MiniTable head={["Category", "Items", "Total"]}>
          {asArray(data.categories).map((c, index) => (
            <tr key={index}>
              <td><span className="capitalize text-ink">{text(c.category)}</span></td>
              <td><span className="font-mono">{(c.items as string[] | undefined)?.join(", ")}</span></td>
              <td><Price formatted={c.total_formatted} /></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "build_itinerary":
      return (
        <MiniTable head={["Day", "Plan", "Items"]}>
          {asArray(data.days).map((d, index) => (
            <tr key={index}>
              <td>{text(d.date_display) || `Day ${text(d.day)}`}</td>
              <td>{text(d.title) || "—"}</td>
              <td><span className="font-mono">{asArray(d.items).map((i) => text(i.id)).join(", ") || "—"}</span></td>
            </tr>
          ))}
        </MiniTable>
      );
    case "create_enquiry":
      return data.enquiry_id ? (
        <Link
          to="/app/enquiries/$enquiryId"
          params={{ enquiryId: text(data.enquiry_id) }}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open enquiry {text(data.number)}
        </Link>
      ) : (
        <p className="text-xs text-dim">{text(data.status)}</p>
      );
    case "draft_quote":
      return data.quote_id ? (
        <Link
          to="/app/quotes/$quoteId"
          params={{ quoteId: text(data.quote_id) }}
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open quote {text(data.number)}
        </Link>
      ) : (
        <p className="text-xs text-dim">{text(data.status)}</p>
      );
    default: {
      const facts = Object.entries(data).filter(([, value]) => typeof value !== "object" || value === null);
      return facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {facts.slice(0, 8).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-faint">{key.replace(/_/g, " ")}</dt>
              <dd className="truncate font-mono text-dim">{text(value) || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-dim">No details.</p>
      );
    }
  }
}

function ToolRow({ call, result, last }: { call: ToolCallStep | null; result: ToolResultStep | null; last: boolean }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const tool = (call?.payload.tool ?? result?.payload.tool) as AgentTool;
  const Icon = TOOL_ICON[tool] ?? MessageSquareText;
  const running = result === null;
  const failed = result !== null && !result.payload.ok;
  const label = call?.payload.label ?? tool.replace(/_/g, " ");
  const took = result?.duration_ms !== null && result?.duration_ms !== undefined ? formatMs(result.duration_ms) : null;
  const status: RowStatus = running
    ? { tone: "primary", label: "Running", live: true }
    : failed
      ? { tone: "danger", label: took ? `Failed · ${took}` : "Failed" }
      : { tone: "ok", label: took ?? "Done" };
  return (
    <Row
      icon={running ? LoaderCircle : failed ? CircleAlert : Icon}
      tone={running ? "primary" : failed ? "danger" : "dim"}
      spin={running}
      status={status}
      last={last}
      action={
        result && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={`${open ? "Hide" : "Show"} details: ${label}`}
              onClick={() => setOpen((value) => !value)}
              className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-dim transition-colors duration-150 ease-tm hover:bg-card-2 hover:text-ink"
            >
              <ChevronDown size={15} aria-hidden="true" className={cn("transition-transform duration-150 ease-tm", open && "rotate-180")} />
            </button>
        )
      }
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-5 text-ink">{label}</p>
        <p className={cn("text-xs leading-4", failed ? "text-danger" : "text-dim")}>
          {running ? "Running…" : result.payload.summary}
          {result?.payload.memo && <span className="text-faint"> · reused an earlier result</span>}
        </p>
      </div>
      {open && result && (
        <div id={detailsId} className="mt-2 rounded-[12px] border border-line bg-card-2 px-3 py-2.5">
          <ToolData tool={tool} data={result.payload.data ?? {}} />
        </div>
      )}
    </Row>
  );
}

/** The inline answer box for a question the plan is waiting on. Takes focus when it appears. */
function QuestionForm({
  pending,
  onReply,
  sending,
  error,
  draft,
  onDraft,
}: {
  pending: PendingQuestion;
  onReply: (text: string) => void;
  sending: boolean;
  error: string | null;
  draft: string;
  onDraft: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const errorId = useId();
  const trimmed = draft.trim();

  useEffect(() => {
    ref.current?.focus();
  }, [pending.call_id]);

  const send = () => {
    if (trimmed && !sending) onReply(trimmed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      aria-label="Answer the question"
      className="card warn tm-enter flex flex-col gap-2 p-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <p className="hud text-warn">Your answer to the question above</p>
      {pending.fields.length > 0 && (
        <p id={hintId} className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
          <span>Needed:</span>
          {pending.fields.map((field) => (
            <Badge key={field} tone="warn">
              {fieldLabel(field)}
            </Badge>
          ))}
        </p>
      )}
      <textarea
        ref={ref}
        rows={2}
        value={draft}
        maxLength={MAX_AGENT_TEXT}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Your answer"
        aria-describedby={[pending.fields.length > 0 ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        placeholder="From Mumbai, 12 to 16 Dec, 2 adults"
        className={cn(FIELD_CONTROL, "h-auto min-h-16 resize-y border-line-strong py-2 leading-5")}
      />
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <CircleAlert size={13} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-faint max-sm:hidden">Enter sends</span>
        <Button type="submit" size="sm" loading={sending} disabled={!trimmed} className="ml-auto">
          <SendHorizontal size={14} aria-hidden="true" />
          Send answer
        </Button>
      </div>
    </form>
  );
}

export type TraceActions = {
  onReply: (text: string) => void;
  replying: boolean;
  replyError: string | null;
  /** The answer being typed to the pending question. */
  answerDraft: string;
  onAnswerDraft: (text: string) => void;
  onDecide: (approve: boolean) => void;
  deciding: "approve" | "decline" | null;
  decideError: string | null;
};

function StepRow({ step, run, last }: { step: Exclude<AgentStep, ToolCallStep | ToolResultStep>; run: AgentRunDetail; last: boolean }) {
  const pending = run.status === "waiting_for_user" ? run.pending : null;
  switch (step.kind) {
    case "thinking":
      return step.payload.text ? (
        <Row icon={MessageSquareText} last={last}>
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-dim">{step.payload.text}</p>
        </Row>
      ) : (
        <Row icon={MessageSquareText} last={last}>
          <p className="text-[13px] leading-5 text-dim">Working…</p>
        </Row>
      );
    case "ask_user": {
      const active = pending !== null && pending.call_id === step.payload.call_id && pending.kind === step.payload.kind;
      if (step.payload.kind === "confirm") {
        return (
          <Row icon={ShieldQuestion} tone="warn" status={active ? { tone: "warn", label: "Waiting", live: true } : undefined} last={last}>
            <p className="tm-micro">{active ? "Waiting for approval" : "Approval asked"}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-ink">{step.payload.action}</p>
          </Row>
        );
      }
      return (
        <Row icon={MessageCircleQuestion} tone="warn" status={active ? { tone: "warn", label: "Waiting", live: true } : undefined} last={last}>
          <p className="tm-micro">{active ? "Question · waiting for your answer" : "Question"}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-ink">{step.payload.question}</p>
        </Row>
      );
    }
    case "user": {
      const payload = step.payload;
      if ("decision" in payload) {
        const approved = payload.decision === "approved";
        return (
          <Row icon={approved ? CircleCheck : CircleX} tone={approved ? "ok" : "dim"} last={last}>
            <p className="text-[13px] leading-5 text-ink">{approved ? "Approved" : "Declined"}</p>
            {payload.action && <p className="text-xs leading-4 text-dim">{payload.action}</p>}
          </Row>
        );
      }
      return (
        <Row icon={UserRound} tone="primary" last={last}>
          <p className="tm-micro">You</p>
          <p className="bubble me mt-1.5 max-w-full whitespace-pre-wrap text-[13px] leading-5 text-ink">{payload.text}</p>
        </Row>
      );
    }
    case "guard": {
      const passed = step.payload.passed;
      const count = step.payload.violations.length;
      return (
        <Row
          icon={passed ? ShieldCheck : ShieldAlert}
          tone={passed ? "ok" : "warn"}
          status={passed ? { tone: "ok", label: "Pass" } : { tone: "warn", label: `${count} flagged` }}
          last={last}
        >
          <p className="text-[13px] font-medium leading-5 text-ink">
            {passed ? "Checked prices against live results" : "Some values couldn't be verified"}
          </p>
          <p className="text-xs leading-4 text-dim">
            {passed
              ? "Every price, flight number, date and airport code matches this plan's results."
              : step.payload.action === "reprompt"
                ? `${count} value${count === 1 ? "" : "s"} not in the results · asked for a corrected answer`
                : `${count} value${count === 1 ? "" : "s"} not in the results · showing results only`}
          </p>
          {!passed && count > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {step.payload.violations.slice(0, 8).map((violation, index) => (
                <li key={`${violation.text}-${index}`}>
                  <Badge tone="warn">{violation.text}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Row>
      );
    }
    case "answer":
      return (
        <Row icon={MessageSquareText} tone="primary" last={last}>
          <p className="hud c-pink">Plan summary</p>
          <div className="mt-1.5 rounded-[14px] border border-line border-l-2 border-l-primary bg-card-2 px-3 py-2.5">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{step.payload.text}</p>
          </div>
        </Row>
      );
    case "error": {
      const retrying = step.payload.code === "timeout";
      return (
        <Row icon={CircleAlert} tone={retrying ? "warn" : "danger"} status={{ tone: retrying ? "warn" : "danger", label: retrying ? "Retry" : "Error" }} last={last}>
          <p className={cn("text-[13px] leading-5", retrying ? "text-warn" : "text-danger")}>{step.payload.message}</p>
        </Row>
      );
    }
    default:
      return null;
  }
}

/** The end of a run that didn't produce a plan: what happened and one way forward. */
function Outcome({ run, onRetry, retrying }: { run: AgentRunDetail; onRetry: () => void; retrying: boolean }) {
  const outcome =
    run.status === "failed"
      ? { icon: CircleAlert, tone: "alert text-danger", title: "This plan didn't finish", body: run.error ?? "Something went wrong while planning. Try again.", action: "Try again" }
      : run.status === "cancelled"
        ? { icon: CircleSlash, tone: "text-dim", title: "Plan cancelled", body: "It stopped before finishing. Nothing was saved.", action: "Run again" }
        : run.status === "budget_exceeded"
          ? {
              icon: Wallet,
              tone: "warn text-warn",
              title: "Plan stopped at its limit",
              body: run.error ?? "It reached the step, time or token limit for one plan before finishing.",
              action: "Run again",
            }
          : null;
  if (!outcome) return null;
  const Icon = outcome.icon;
  return (
    <div role="status" className={cn("card tm-enter flex flex-wrap items-start gap-3 p-3.5", outcome.tone)}>
      <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">{outcome.title}</p>
        <p className="mt-0.5 text-xs leading-4 text-dim">{outcome.body}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
        <RotateCcw size={14} aria-hidden="true" />
        {outcome.action}
      </Button>
    </div>
  );
}

/** While the plan works: a live line under the trace (announced politely). */
function Working({ status }: { status: AgentRunDetail["status"] }) {
  return (
    <div role="status" className="callout flex-col gap-2 px-3 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <LoaderCircle size={14} aria-hidden="true" className="tm-spin shrink-0 text-primary" />
        {status === "queued" ? "Queued · starting shortly" : "Planning · searching live sources"}
      </p>
      <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-line-2">
        <div className="tm-progress-sweep h-full rounded-full bg-[image:var(--grad)]" />
      </div>
    </div>
  );
}

/**
 * The conversation and its live trace: the request, every step in order (tool calls with their result, the
 * price check, questions, replies, decisions and the summary) in a polite live log; after it, the answer box
 * or approval card the run is waiting on (kept out of the log so typing is never announced), a live line
 * while it works and how it ended.
 */
export function RunTrace({
  run,
  actions,
  onRetry,
  retrying,
  logRef,
}: {
  run: AgentRunDetail;
  actions: TraceActions;
  onRetry: () => void;
  retrying: boolean;
  /** The log itself: focus returns here after an answer is sent. */
  logRef?: Ref<HTMLDivElement>;
}) {
  const items = traceItems(run.steps);
  const working = isWorking(run.status);
  const pending = run.status === "waiting_for_user" ? run.pending : null;
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={logRef}
        tabIndex={-1}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Plan trace"
        className="rounded-md focus:outline-2 focus:outline-offset-4 focus:outline-primary"
      >
        <ol className="list">
        <Row icon={UserRound} tone="primary" last={items.length === 0}>
          <p className="hud">Request</p>
          <p className="bubble me mt-1.5 max-w-full whitespace-pre-wrap text-[13px] leading-5 text-ink">{run.prompt}</p>
        </Row>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return item.type === "tool" ? (
            <ToolRow key={item.key} call={item.call} result={item.result} last={last} />
          ) : (
            <StepRow key={item.key} step={item.step} run={run} last={last} />
          );
        })}
        </ol>
      </div>
      {pending?.kind === "question" && (
        <QuestionForm
          pending={pending as PendingQuestion}
          onReply={actions.onReply}
          sending={actions.replying}
          error={actions.replyError}
          draft={actions.answerDraft}
          onDraft={actions.onAnswerDraft}
        />
      )}
      {pending?.kind === "confirm" && (
        <ConfirmActionCard
          pending={pending as PendingConfirm}
          onDecide={actions.onDecide}
          deciding={actions.deciding}
          error={actions.decideError}
        />
      )}
      {working && <Working status={run.status} />}
      <Outcome run={run} onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

/** "12 steps · 4 tool calls" style counts for the run's telemetry. */
export function traceCounts(steps: readonly AgentStep[]) {
  const toolResults = steps.filter((s): s is ToolResultStep => s.kind === "tool_result");
  return {
    steps: steps.length,
    tools: toolResults.length,
    toolMs: toolResults.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    failures: toolResults.filter((s) => !s.payload.ok).length,
    timings: toolResults.map((s) => ({ tool: s.payload.tool, ms: s.duration_ms ?? 0 })),
  };
}

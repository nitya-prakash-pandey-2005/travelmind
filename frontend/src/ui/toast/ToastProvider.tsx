import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { cn } from "../cn";
import { ToastContext, type ToastInput, type ToastTone } from "./useToast";

const MAX_VISIBLE = 3;
const DURATION_MS = 5000;

type Toast = ToastInput & { id: string };

const TONES: Record<ToastTone, { icon: LucideIcon; text: string; bar: string }> = {
  ok: { icon: CircleCheck, text: "text-ok", bar: "bg-ok" },
  warn: { icon: TriangleAlert, text: "text-warn", bar: "bg-warn" },
  danger: { icon: CircleAlert, text: "text-danger", bar: "bg-danger" },
  info: { icon: Info, text: "text-primary", bar: "bg-primary" },
};

/** Provides `useToast()` and renders the toast stack (bottom-right; full width on phones). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    nextId.current += 1;
    const id = `toast-${nextId.current}`;
    // Oldest leaves first once the stack is full.
    setToasts((current) => [...current, { ...input, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96">
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(DURATION_MS);
  const paused = hovered || focused;
  const { icon: Icon, text, bar } = TONES[toast.tone];

  // Count down only while neither hovered nor focused; pausing banks the time left.
  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, toast.id, onDismiss]);

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      className="tm-enter tm-edge pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-md bg-glass-strong py-3 pl-4 pr-2 shadow-(--tm-shadow-pop) backdrop-blur-xl"
    >
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-0.5", bar)} />
      <Icon size={18} aria-hidden="true" className={cn("mt-0.5 shrink-0", text)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-dim">{toast.description}</p>}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-150 ease-tm hover:bg-hover hover:text-ink"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

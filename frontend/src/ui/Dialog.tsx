import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { cn } from "./cn";

export type DialogProps = {
  /** Mounted only while true. Mark the element that should take focus on open with `data-autofocus`. */
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title. */
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export type ModalSurfaceProps = Omit<DialogProps, "open"> & { placement: "center" | "side" };

// The kit sheet: a solid sheet surface with a soft hairline. Desktop: a centred dialog, or a panel inset 12px from
// the right edge. Phones (760px and below): both rise from the bottom as a sheet, up to 88% of the screen.
const PHONE_SHEET =
  "max-[760px]:mx-0 max-[760px]:mb-0 max-[760px]:mt-auto max-[760px]:h-auto max-[760px]:max-h-[88dvh] max-[760px]:w-full max-[760px]:rounded-b-none max-[760px]:rounded-t-[24px] max-[760px]:border-x-0 max-[760px]:border-b-0";
const PLACEMENT = {
  center: cn("tm-modal m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] max-w-none rounded-[24px]", PHONE_SHEET),
  side: cn(
    "tm-modal-side my-3 ml-auto mr-3 h-[calc(100dvh-24px)] max-h-[calc(100dvh-24px)] w-[min(440px,calc(100vw-24px))] max-w-none rounded-[28px]",
    PHONE_SHEET,
  ),
};

/**
 * The open modal (shared by Dialog and Drawer). Mounted only while open, so content state resets between openings.
 * The browser traps focus inside (showModal) and paints the backdrop; Escape and backdrop clicks ask the
 * owner to close; on close, focus returns to whatever opened it.
 */
export function ModalSurface({ onClose, title, description, children, footer, className, placement }: ModalSurfaceProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // Initial focus: an element marked data-autofocus (React's autoFocus fires before the dialog is shown,
    // so it can't be used here); else the first focusable element of the body, then of the footer; the
    // header Close button only as a last resort. This overrides the platform default (the first focusable
    // element in the dialog, i.e. Close).
    const initial =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      footerRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      closeRef.current;
    initial?.focus();
    // Closed by the platform (e.g. a <form method="dialog">): tell the owner. Browsers fire "close" in a
    // later task, so one left over from an earlier close (StrictMode re-runs this effect: close, then
    // showModal) can arrive while the dialog is open again; that one is ignored.
    const onNativeClose = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("close", onNativeClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape: keep the element open until the owner flips `open`, so state stays the source of truth.
    event.preventDefault();
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  }

  // The <dialog> box has no padding, so an event whose target is the element itself hit the backdrop.
  // Close only when the press also started there: a text selection dragged out of an input ends with a
  // click on the dialog element and must not dismiss it.
  function onPointerDown(event: PointerEvent<HTMLDialogElement>) {
    pointerDownOnBackdrop.current = event.target === event.currentTarget;
  }

  function onClick(event: MouseEvent<HTMLDialogElement>) {
    const startedOnBackdrop = pointerDownOnBackdrop.current;
    pointerDownOnBackdrop.current = false;
    if (startedOnBackdrop && event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={cn(
        "border border-line-soft bg-surface p-0 text-ink",
        "open:flex open:flex-col",
        PLACEMENT[placement],
        className,
      )}
    >
      {/* The phone sheet's grab handle (decorative: Escape, the scrim and Close dismiss it). */}
      <span aria-hidden="true" className="mx-auto mt-2 hidden h-1 w-10 shrink-0 rounded-full bg-line-soft max-[760px]:block" />
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4 max-[760px]:pt-2">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-0.5 text-[13px] leading-5 text-dim">
              {description}
            </p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1.5 -mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line text-dim transition-colors duration-150 ease-tm hover:bg-card-2 hover:text-ink"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
        {children}
      </div>
      {footer && (
        <footer
          ref={footerRef}
          className="flex flex-wrap items-center justify-end gap-2 rounded-b-[inherit] border-t border-line bg-card-2 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {footer}
        </footer>
      )}
    </dialog>
  );
}

/** Centred modal dialog on the native <dialog> element. */
export function Dialog({ open, ...props }: DialogProps) {
  if (!open) return null;
  return <ModalSurface {...props} placement="center" />;
}

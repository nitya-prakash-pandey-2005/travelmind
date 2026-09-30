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

const PLACEMENT = {
  center: "tm-modal m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] max-w-none rounded-lg",
  side: "tm-modal-side my-0 ml-auto mr-0 h-dvh max-h-dvh w-[min(28rem,100vw)] max-w-none rounded-l-lg",
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
    // Closed by the platform (e.g. a <form method="dialog">): tell the owner.
    const onNativeClose = () => onCloseRef.current();
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
        "tm-edge bg-glass-strong p-0 text-ink backdrop-blur-xl",
        "open:flex open:flex-col",
        PLACEMENT[placement],
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg tracking-wide text-ink">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-0.5 text-sm text-dim">
              {description}
            </p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-dim transition-colors duration-200 ease-tm hover:bg-hover hover:text-ink"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {children}
      </div>
      {footer && (
        <footer
          ref={footerRef}
          className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3"
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

import { ModalSurface, type DialogProps } from "./Dialog";

/**
 * The kit Sheet: a panel from the right on desktop and a bottom sheet on phones, with the same behaviour as Dialog
 * (focus trap, Escape, focus return).
 */
export function Drawer({ open, ...props }: DialogProps) {
  if (!open) return null;
  return <ModalSurface {...props} placement="side" />;
}

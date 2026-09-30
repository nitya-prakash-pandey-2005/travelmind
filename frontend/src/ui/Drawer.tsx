import { ModalSurface, type DialogProps } from "./Dialog";

/** Modal side panel sliding in from the right: same behaviour as Dialog (focus trap, Escape, focus return). */
export function Drawer({ open, ...props }: DialogProps) {
  if (!open) return null;
  return <ModalSurface {...props} placement="side" />;
}

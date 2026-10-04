import { ArrowRightLeft, ChevronDown } from "lucide-react";
import { ENQUIRY_TRANSITIONS, type EnquiryOut, type EnquiryStatus } from "../../api/enquiries";
import { Menu } from "../../ui/Menu";
import { stageLabel } from "./enquiryFacts";

type MoveMenuProps = {
  enquiry: Pick<EnquiryOut, "number" | "status">;
  onMove: (to: EnquiryStatus) => void;
  /** icon: a compact icon trigger for cards and rows · button: a labelled "Move" button for page headers. */
  variant?: "icon" | "button";
  className?: string;
};

/**
 * The keyboard way to move an enquiry: a menu of the stages it may move to (the drag and drop
 * alternative). Nothing renders when the enquiry can't move (a won enquiry is final).
 */
export function MoveMenu({ enquiry, onMove, variant = "icon", className }: MoveMenuProps) {
  const targets = ENQUIRY_TRANSITIONS[enquiry.status];
  if (targets.length === 0) return null;
  return (
    <Menu
      label={`Move ${enquiry.number}`}
      className={className}
      align="end"
      triggerVariant={variant === "icon" ? "ghost" : "secondary"}
      triggerClassName={variant === "icon" ? "h-7 w-7 justify-center" : undefined}
      trigger={
        variant === "icon" ? (
          <ArrowRightLeft size={14} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <>
            <ArrowRightLeft size={14} strokeWidth={1.75} aria-hidden="true" className="text-dim" />
            Move
            <ChevronDown size={14} aria-hidden="true" className="text-dim" />
          </>
        )
      }
      items={targets.map((to) => ({
        id: to,
        label: `Move to ${stageLabel(to)}`,
        separated: to === "lost" && targets.indexOf(to) > 0,
        onSelect: () => onMove(to),
      }))}
    />
  );
}

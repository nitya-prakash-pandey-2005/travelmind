import { useNavigate } from "@tanstack/react-router";
import { CircleHelp, Keyboard, Palette, PlugZap } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Kbd } from "../ui/Kbd";
import { Menu } from "../ui/Menu";

const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ["Ctrl", "K"], action: "Search and run commands" },
  { keys: ["Esc"], action: "Close a dialog, drawer or menu" },
  { keys: ["←", "→"], action: "Move between tabs, or along a chart" },
  { keys: ["Enter"], action: "Open the focused table row" },
];

/** Help (?) in the top bar: keyboard shortcuts, supplier status and the design system. */
export function HelpMenu() {
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <>
      <Menu
        label="Help"
        triggerVariant="ghost"
        triggerClassName="h-9 w-9 justify-center"
        trigger={<CircleHelp size={17} strokeWidth={1.75} aria-hidden="true" />}
        items={[
          { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, onSelect: () => setShortcutsOpen(true) },
          { id: "suppliers", label: "Supplier status", icon: PlugZap, onSelect: () => void navigate({ to: "/app/suppliers" }) },
          { id: "design", label: "Design system", icon: Palette, onSelect: () => void navigate({ to: "/app/design" }) },
        ]}
      />
      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setShortcutsOpen(false)}>
            Done
          </Button>
        }
      >
        <dl className="flex flex-col divide-y divide-line">
          {SHORTCUTS.map(({ keys, action }) => (
            <div key={action} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <dt className="text-[13px] text-ink">{action}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </>
  );
}

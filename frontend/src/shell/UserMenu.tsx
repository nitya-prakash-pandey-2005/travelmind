import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Palette, SwatchBook } from "lucide-react";
import { useState } from "react";
import type { Me } from "../api/types";
import { useLogout } from "../auth/useLogout";
import { themeMeta, useThemeChoice } from "../theme";
import { ThemePanel } from "../theme/ThemeSwitcher";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Menu, type MenuItem } from "../ui/Menu";

/**
 * Avatar button (named after the user) opening the account menu. Its theme entry opens the theme list in a dialog,
 * which is how phones reach it (the top-bar switcher is hidden there).
 */
export function UserMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [choice] = useThemeChoice();
  const [themeOpen, setThemeOpen] = useState(false);
  const items: MenuItem[] = [
    { id: "theme", label: `Theme: ${themeMeta(choice.theme).name}`, icon: SwatchBook, onSelect: () => setThemeOpen(true) },
    { id: "design", label: "Design system", icon: Palette, onSelect: () => void navigate({ to: "/app/design" }) },
    { id: "sign-out", label: "Sign out", icon: LogOut, onSelect: () => logout.mutate(), separated: true },
  ];
  return (
    <>
      <Menu
        label={me.user.full_name}
        items={items}
        triggerVariant="ghost"
        triggerClassName="h-10 rounded-[14px] pl-1 pr-1 lg:border lg:border-line lg:bg-card lg:pr-2.5"
        header={
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium text-ink">{me.user.full_name}</span>
            <span className="truncate text-xs text-dim">{me.user.email}</span>
          </div>
        }
        trigger={
          <>
            <Avatar name={me.user.full_name} size="md" />
            <span className="hidden min-w-0 flex-col items-start leading-none lg:flex">
              <span className="max-w-36 truncate text-[13px] font-semibold leading-4 text-ink">{me.user.full_name}</span>
              <span className="text-[11px] capitalize leading-4 text-faint">{me.user.role}</span>
            </span>
            <ChevronDown size={14} aria-hidden="true" className="hidden text-faint lg:block" />
          </>
        }
      />
      <Dialog
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        title="Theme"
        description="Applies straight away and is remembered on this device."
        footer={
          <Button variant="secondary" size="sm" onClick={() => setThemeOpen(false)}>
            Done
          </Button>
        }
      >
        <ThemePanel autoFocusList className="-mx-2 -my-2" />
      </Dialog>
    </>
  );
}

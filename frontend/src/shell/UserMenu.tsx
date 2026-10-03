import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Moon, Palette, Sun } from "lucide-react";
import type { Me } from "../api/types";
import { useLogout } from "../auth/useLogout";
import { Avatar } from "../ui/Avatar";
import { Menu, type MenuItem } from "../ui/Menu";
import { useModeToggle } from "../theme";

/** Avatar button (named after the user) opening the account menu. Settings joins it with the settings pages. */
export function UserMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const modeToggle = useModeToggle();
  const items: MenuItem[] = [
    ...(modeToggle.available
      ? [{ id: "theme", label: modeToggle.label, icon: modeToggle.mode === "dark" ? Sun : Moon, onSelect: modeToggle.toggle }]
      : []),
    { id: "design", label: "Design system", icon: Palette, onSelect: () => void navigate({ to: "/app/design" }) },
    { id: "sign-out", label: "Sign out", icon: LogOut, onSelect: () => logout.mutate(), separated: true },
  ];
  return (
    <Menu
      label={me.user.full_name}
      items={items}
      triggerVariant="ghost"
      triggerClassName="pl-1 pr-1 lg:pr-1.5"
      header={
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-ink">{me.user.full_name}</span>
          <span className="truncate text-xs text-dim">{me.user.email}</span>
        </div>
      }
      trigger={
        <>
          <Avatar name={me.user.full_name} size="sm" />
          <span className="hidden min-w-0 flex-col items-start leading-none lg:flex">
            <span className="max-w-36 truncate text-xs font-medium leading-4 text-ink">{me.user.full_name}</span>
            <span className="text-[11px] capitalize leading-3.5 text-faint">{me.user.role}</span>
          </span>
          <ChevronDown size={14} aria-hidden="true" className="hidden text-faint lg:block" />
        </>
      }
    />
  );
}

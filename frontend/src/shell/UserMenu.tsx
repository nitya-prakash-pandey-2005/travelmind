import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Moon, Palette, Sun } from "lucide-react";
import type { Me } from "../api/types";
import { useLogout } from "../auth/useLogout";
import { Avatar } from "../ui/Avatar";
import { Menu, type MenuItem } from "../ui/Menu";
import { useTheme } from "../ui/theme";

/** Avatar button (named after the user) opening the account menu. Settings joins it with the settings pages. */
export function UserMenu({ me }: { me: Me }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [theme, setTheme] = useTheme();
  const items: MenuItem[] = [
    {
      id: "theme",
      label: theme === "dark" ? "Switch to daylight theme" : "Switch to dark theme",
      icon: theme === "dark" ? Sun : Moon,
      onSelect: () => setTheme(theme === "dark" ? "daylight" : "dark"),
    },
    { id: "design", label: "Design system", icon: Palette, onSelect: () => void navigate({ to: "/app/design" }) },
    { id: "sign-out", label: "Sign out", icon: LogOut, onSelect: () => logout.mutate() },
  ];
  return (
    <Menu
      label={me.user.full_name}
      items={items}
      triggerClassName="h-9 gap-2 border-transparent pl-1 pr-1.5 hover:bg-hover md:pr-2"
      trigger={
        <>
          <Avatar name={me.user.full_name} size="md" />
          <span className="hidden min-w-0 flex-col items-start leading-tight md:flex">
            <span className="max-w-36 truncate text-sm text-ink">{me.user.full_name}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">{me.user.role}</span>
          </span>
          <ChevronDown size={14} aria-hidden="true" className="hidden text-dim md:block" />
        </>
      }
    />
  );
}

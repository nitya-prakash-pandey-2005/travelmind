import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { createQueryClient } from "../api/queryClient";
import { ToastProvider } from "../ui/toast/ToastProvider";

export function renderWithClient(ui: ReactElement) {
  const queryClient = createQueryClient({ retry: false });
  const user = userEvent.setup();
  // Pass the provider as `wrapper` (not inline) so `rerender` keeps it.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const result = render(ui, { wrapper });
  return { ...result, user, queryClient };
}

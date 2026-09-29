import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { createQueryClient } from "../api/queryClient";

export function renderWithClient(ui: ReactElement) {
  const queryClient = createQueryClient({ retry: false });
  const user = userEvent.setup();
  // Pass the provider as `wrapper` (not inline) so `rerender` keeps it.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const result = render(ui, { wrapper });
  return { ...result, user, queryClient };
}

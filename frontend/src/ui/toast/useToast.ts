import { createContext, useContext } from "react";

export type ToastTone = "ok" | "warn" | "danger" | "info";

export type ToastInput = {
  tone: ToastTone;
  title: string;
  description?: string;
};

export type ToastApi = {
  /** Show a toast; returns its id. Danger toasts are announced assertively (role="alert"). */
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

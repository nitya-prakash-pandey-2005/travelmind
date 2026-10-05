// The UI kit's faces, self-hosted: Inter for the interface, Space Grotesk for titles and big numbers,
// JetBrains Mono for HUD labels and data.
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/queryClient";
import { AppProviders } from "./app/AppProviders";
import { createAppRouter } from "./router";
import { initTheme } from "./theme";

initTheme();
const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient} router={router} />
  </StrictMode>,
);

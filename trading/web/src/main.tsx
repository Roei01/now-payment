import { createRoot } from "react-dom/client";
import "@fontsource-variable/heebo";
import { App } from "./App";
import { UIProvider } from "./components/overlay";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <UIProvider>
    <App />
  </UIProvider>,
);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

import { Buffer } from "buffer";
// @arch-network/arch-sdk derives PDAs/ATAs with Node's Buffer; the browser has
// none, so polyfill it before any SDK code runs (fixes "Buffer is not defined").
if (!(globalThis as unknown as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

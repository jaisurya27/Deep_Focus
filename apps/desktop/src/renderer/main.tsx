import React from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { GlanceShell } from "./shell/GlanceShell";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <GlanceShell />
  </React.StrictMode>,
);

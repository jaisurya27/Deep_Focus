import React from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { AnswerPanel } from "./panels/AnswerPanel";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <AnswerPanel />
  </React.StrictMode>,
);

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type OverlayInfo = {
  display: { x: number; y: number; width: number; height: number };
  captureSize: { width: number; height: number };
};

function App() {
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const off = window.deepFocus?.overlay?.onStart?.((payload) => {
      setInfo(payload as OverlayInfo);
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.deepFocus?.overlay?.cancel?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    const p = { x: e.clientX, y: e.clientY };
    setStart(p);
    setCurrent(p);
  };
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  };
  const onMouseUp = () => {
    draggingRef.current = false;
    console.info("[overlay] mouseup", { start, current, info });
    if (!info) {
      // We never got OVERLAY_START — fall back to window-relative coords.
      // Each overlay window covers exactly one display, so passing raw coords
      // works even without the display origin (main process will map them).
      console.warn("[overlay] no OverlayInfo — cancelling capture");
      window.deepFocus?.overlay?.cancel?.();
      return;
    }
    if (!start || !current) {
      console.warn("[overlay] no drag recorded — cancelling");
      window.deepFocus?.overlay?.cancel?.();
      return;
    }
    const rect = normalize(start, current);
    if (rect.width < 4 || rect.height < 4) {
      console.info("[overlay] drag too small — cancelling");
      window.deepFocus?.overlay?.cancel?.();
      return;
    }
    const screenRect: Rect = {
      x: rect.x + info.display.x,
      y: rect.y + info.display.y,
      width: rect.width,
      height: rect.height,
    };
    console.info("[overlay] sending OVERLAY_COMPLETE", screenRect);
    window.deepFocus?.overlay?.complete?.(screenRect);
  };

  const selectionRect = useMemo(() => {
    if (!start || !current) return null;
    return normalize(start, current);
  }, [start, current]);

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.38)",
        cursor: "crosshair",
      }}
    >
      {/* Dim mask with a punched-out rectangle for the selection. */}
      {selectionRect ? (
        <>
          <div
            style={{
              position: "absolute",
              left: selectionRect.x,
              top: selectionRect.y,
              width: selectionRect.width,
              height: selectionRect.height,
              border: "1.5px solid #10b981",
              boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.45)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: Math.min(selectionRect.x + selectionRect.width + 8, window.innerWidth - 96),
              top: Math.max(selectionRect.y, 8),
              padding: "4px 8px",
              borderRadius: 6,
              background: "rgba(15, 23, 42, 0.92)",
              color: "#e2e8f0",
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 11,
              pointerEvents: "none",
              border: "1px solid rgba(148, 163, 184, 0.25)",
            }}
          >
            {Math.round(selectionRect.width)} × {Math.round(selectionRect.height)}
          </div>
        </>
      ) : (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 24,
            transform: "translateX(-50%)",
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(15, 23, 42, 0.88)",
            color: "#e2e8f0",
            fontFamily: "Manrope, ui-sans-serif, sans-serif",
            fontSize: 12,
            border: "1px solid rgba(16, 185, 129, 0.35)",
            pointerEvents: "none",
            letterSpacing: 0.3,
          }}
        >
          Drag to capture · Esc to cancel
        </div>
      )}
    </div>
  );
}

function normalize(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return { x, y, width, height };
}

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

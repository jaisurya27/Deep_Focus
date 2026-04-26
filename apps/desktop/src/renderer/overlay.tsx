import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type Point = { x: number; y: number; screenX: number; screenY: number };
type Rect = { x: number; y: number; width: number; height: number };

function App() {
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const draggingRef = useRef(false);
  const startRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.deepFocus?.overlay?.cancel?.("esc");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const finishDrag = (trigger: string) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const s = startRef.current;
    const c = currentRef.current;
    console.info("[overlay] finishDrag", { trigger, start: s, current: c });
    if (!s || !c) {
      window.deepFocus?.overlay?.cancel?.("no-points");
      return;
    }
    // Client rect (window-local) for min-size checks, screen rect for capture.
    const client = normalize(
      { x: s.x, y: s.y },
      { x: c.x, y: c.y },
    );
    if (client.width < 2 || client.height < 2) {
      window.deepFocus?.overlay?.cancel?.(
        `too-small(${Math.round(client.width)}x${Math.round(client.height)})`,
      );
      return;
    }
    const screenRect = normalize(
      { x: s.screenX, y: s.screenY },
      { x: c.screenX, y: c.screenY },
    );
    console.info("[overlay] sending OVERLAY_COMPLETE", screenRect);
    window.deepFocus?.overlay?.complete?.(screenRect);
  };

  useEffect(() => {
    const onUp = () => finishDrag("window-pointerup");
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    const p: Point = {
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
    };
    startRef.current = p;
    currentRef.current = p;
    setStart(p);
    setCurrent(p);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const p: Point = {
      x: e.clientX,
      y: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
    };
    currentRef.current = p;
    setCurrent(p);
  };
  const onPointerUp = () => finishDrag("pointerup");
  const onPointerCancel = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.deepFocus?.overlay?.cancel?.("pointer-cancel");
  };

  const selectionRect = useMemo(() => {
    if (!start || !current) return null;
    return normalize(
      { x: start.x, y: start.y },
      { x: current.x, y: current.y },
    );
  }, [start, current]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.38)",
        cursor: "crosshair",
      }}
    >
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
              left: Math.min(
                selectionRect.x + selectionRect.width + 8,
                window.innerWidth - 96,
              ),
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
            {Math.round(selectionRect.width)} ×{" "}
            {Math.round(selectionRect.height)}
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

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

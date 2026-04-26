import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getStroke } from "perfect-freehand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "rect" | "freehand";
type Point = { x: number; y: number; screenX: number; screenY: number };
type Rect = { x: number; y: number; width: number; height: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Bounding box of a list of [x, y] points. */
function boundingBox(pts: [number, number][]): Rect | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Convert perfect-freehand outline points to an SVG path d string. */
function toSvgPath(outline: number[][]): string {
  if (!outline.length) return "";
  const [first, ...rest] = outline as [number, number][];
  const parts = [`M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`];
  for (const [x, y] of rest) {
    parts.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [mode, setMode] = useState<Mode>("freehand");

  // ---- rect mode state ----
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [rectCurrent, setRectCurrent] = useState<Point | null>(null);

  // ---- freehand mode state ----
  // Each element: [clientX, clientY, pressure]
  const [freehandPts, setFreehandPts] = useState<[number, number, number][]>([]);
  // Parallel array of screen coords (same index as freehandPts)
  const screenPtsRef = useRef<{ screenX: number; screenY: number }[]>([]);

  const draggingRef = useRef(false);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;

  // Keep refs in sync for use inside event handlers
  const rectStartRef = useRef<Point | null>(null);
  const rectCurrentRef = useRef<Point | null>(null);
  const freehandPtsRef = useRef<[number, number, number][]>([]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.deepFocus?.overlay?.cancel?.("esc");
        return;
      }
      if (!draggingRef.current) {
        if (e.key === "r" || e.key === "R") setMode("rect");
        if (e.key === "f" || e.key === "F") setMode("freehand");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- finish handlers ----
  const finishRect = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const s = rectStartRef.current;
    const c = rectCurrentRef.current;
    if (!s || !c) { window.deepFocus?.overlay?.cancel?.("no-points"); return; }
    const client = normalize({ x: s.x, y: s.y }, { x: c.x, y: c.y });
    if (client.width < 2 || client.height < 2) {
      window.deepFocus?.overlay?.cancel?.(`too-small(${Math.round(client.width)}x${Math.round(client.height)})`);
      return;
    }
    const screenRect = normalize({ x: s.screenX, y: s.screenY }, { x: c.screenX, y: c.screenY });
    window.deepFocus?.overlay?.complete?.(screenRect);
  };

  const finishFreehand = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const pts = freehandPtsRef.current;
    const screenPts = screenPtsRef.current;
    if (pts.length < 3 || screenPts.length < 3) {
      window.deepFocus?.overlay?.cancel?.("too-small");
      return;
    }
    const clientBox = boundingBox(pts.map(([x, y]) => [x, y]));
    if (!clientBox || clientBox.width < 10 || clientBox.height < 10) {
      window.deepFocus?.overlay?.cancel?.("too-small");
      return;
    }
    // Build screen bounding box from the screen coord parallel array
    const screenBox = boundingBox(screenPts.map((p) => [p.screenX, p.screenY]));
    if (!screenBox) { window.deepFocus?.overlay?.cancel?.("no-screen-box"); return; }
    // Add a small padding so the captured region includes the stroke edge
    const pad = 8;
    const paddedScreen = {
      x: screenBox.x - pad,
      y: screenBox.y - pad,
      width: screenBox.width + pad * 2,
      height: screenBox.height + pad * 2,
    };
    window.deepFocus?.overlay?.complete?.(paddedScreen);
  };

  // Global pointerup safety net
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      if (modeRef.current === "rect") finishRect();
      else finishFreehand();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ---- pointer handlers ----
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    if (modeRef.current === "rect") {
      const p: Point = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
      rectStartRef.current = p;
      rectCurrentRef.current = p;
      setRectStart(p);
      setRectCurrent(p);
    } else {
      const pt: [number, number, number] = [e.clientX, e.clientY, e.pressure || 0.5];
      freehandPtsRef.current = [pt];
      screenPtsRef.current = [{ screenX: e.screenX, screenY: e.screenY }];
      setFreehandPts([pt]);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (modeRef.current === "rect") {
      const p: Point = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
      rectCurrentRef.current = p;
      setRectCurrent(p);
    } else {
      const pt: [number, number, number] = [e.clientX, e.clientY, e.pressure || 0.5];
      freehandPtsRef.current = [...freehandPtsRef.current, pt];
      screenPtsRef.current = [...screenPtsRef.current, { screenX: e.screenX, screenY: e.screenY }];
      setFreehandPts([...freehandPtsRef.current]);
    }
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    if (modeRef.current === "rect") finishRect();
    else finishFreehand();
  };

  const onPointerCancel = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.deepFocus?.overlay?.cancel?.("pointer-cancel");
  };

  // ---- derived visuals ----
  const selectionRect = rectStart && rectCurrent
    ? normalize({ x: rectStart.x, y: rectStart.y }, { x: rectCurrent.x, y: rectCurrent.y })
    : null;

  const strokePath = freehandPts.length > 1
    ? toSvgPath(getStroke(freehandPts, {
        size: 3,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      }) as number[][])
    : "";

  const freehandBox = freehandPts.length > 2
    ? boundingBox(freehandPts.map(([x, y]) => [x, y]))
    : null;

  const drawing = draggingRef.current;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: drawing ? "rgba(2, 6, 23, 0.32)" : "rgba(2, 6, 23, 0.38)",
        cursor: mode === "freehand" ? "crosshair" : "crosshair",
        transition: "background 0.1s",
      }}
    >
      {/* Mode picker — shown before drawing starts */}
      {!drawing && (
        <div style={{
          position: "absolute",
          left: "50%",
          top: 24,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 6px",
          borderRadius: 999,
          background: "rgba(15, 23, 42, 0.92)",
          border: "1px solid rgba(16, 185, 129, 0.35)",
          pointerEvents: "auto",
          userSelect: "none",
        }}>
          <ModeButton label="▭ Region" active={mode === "rect"} onClick={() => setMode("rect")} kbd="R" />
          <ModeButton label="✏ Circle" active={mode === "freehand"} onClick={() => setMode("freehand")} kbd="F" />
          <span style={{
            color: "rgba(148,163,184,0.6)",
            fontFamily: "Manrope, ui-sans-serif, sans-serif",
            fontSize: 11,
            marginLeft: 4,
          }}>
            · Esc to cancel
          </span>
        </div>
      )}

      {/* Rect mode selection */}
      {mode === "rect" && selectionRect && (
        <>
          <div style={{
            position: "absolute",
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
            border: "1.5px solid #10b981",
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.45)",
            pointerEvents: "none",
          }} />
          <div style={{
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
          }}>
            {Math.round(selectionRect.width)} × {Math.round(selectionRect.height)}
          </div>
        </>
      )}

      {/* Freehand mode stroke + bounding box preview */}
      {mode === "freehand" && (
        <svg
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {/* Dashed bounding box around the drawn shape */}
          {freehandBox && (
            <rect
              x={freehandBox.x - 6}
              y={freehandBox.y - 6}
              width={freehandBox.width + 12}
              height={freehandBox.height + 12}
              fill="none"
              stroke="#10b981"
              strokeWidth={1}
              strokeDasharray="5 3"
              rx={4}
            />
          )}
          {/* The freehand stroke itself */}
          {strokePath && (
            <path
              d={strokePath}
              fill="rgba(16, 185, 129, 0.55)"
              stroke="rgba(16, 185, 129, 0.9)"
              strokeWidth={0.5}
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeButton
// ---------------------------------------------------------------------------

function ModeButton({
  label,
  active,
  onClick,
  kbd,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  kbd: string;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        borderRadius: 999,
        border: active ? "1px solid rgba(16,185,129,0.6)" : "1px solid transparent",
        background: active ? "rgba(16,185,129,0.15)" : "transparent",
        color: active ? "#6ee7b7" : "rgba(148,163,184,0.7)",
        fontFamily: "Manrope, ui-sans-serif, sans-serif",
        fontSize: 12,
        cursor: "pointer",
        letterSpacing: 0.2,
        transition: "all 0.12s",
      }}
    >
      {label}
      <span style={{
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 9,
        opacity: 0.5,
        marginLeft: 2,
      }}>
        [{kbd}]
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } as const;
const SPRING_BOUNCY = { type: "spring", stiffness: 520, damping: 26, mass: 0.9 } as const;

type Phase = "request" | "processing" | "confirmed";

type Props = {
  restaurantName?: string;
  onConfirm: () => void;
  onDecline: () => void;
};

export function FetPaymentGate({ restaurantName, onConfirm, onDecline }: Props) {
  const [phase, setPhase] = useState<Phase>("request");

  const handlePay = async () => {
    setPhase("processing");
    // Simulate testnet tx confirmation delay
    await new Promise((r) => setTimeout(r, 1800));
    setPhase("confirmed");
    await new Promise((r) => setTimeout(r, 900));
    onConfirm();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={SPRING}
      className="glass w-full rounded-[22px] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <FetchAiLogo />
        <div className="flex-1">
          <div className="text-[11px] font-mono uppercase tracking-widest text-slate-400">
            Fetch.ai Agentverse
          </div>
          <div className="text-[13px] font-semibold text-slate-100">
            Payment Request
          </div>
        </div>
        <div className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-300">
          testnet
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-4 flex flex-col gap-3">
        <AnimatePresence mode="wait">
          {phase === "request" && (
            <motion.div
              key="request"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-3"
            >
              {/* Amount hero */}
              <div className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/50 px-4 py-3">
                <div>
                  <div className="text-[11px] text-slate-500">Amount</div>
                  <div className="text-[22px] font-light text-slate-100 tracking-tight">
                    0.10 <span className="text-[14px] text-slate-400">FET</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">Service</div>
                  <div className="text-[12px] text-slate-300">Restaurant Booking</div>
                  {restaurantName ? (
                    <div className="text-[11px] text-slate-500 truncate max-w-[140px]">
                      via ConnectAgent
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-1.5 text-[11.5px] text-slate-400">
                <Row label="From" value="your wallet" />
                <Row label="To" value="GlanceConnectAgent" mono />
                <Row label="Network" value="Fetch.ai testnet" />
                <Row label="Protocol" value="Payment Protocol v1" />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onDecline}
                  className="flex-1 rounded-xl border border-slate-700/60 bg-slate-900/40 py-2.5 text-[13px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                >
                  Decline
                </button>
                <motion.button
                  onClick={handlePay}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING_BOUNCY}
                  className="flex-[2] rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:from-violet-500 hover:to-indigo-500"
                >
                  Pay 0.10 FET
                </motion.button>
              </div>
            </motion.div>
          )}

          {phase === "processing" && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={SPRING}
              className="flex flex-col items-center gap-3 py-4"
            >
              <Spinner />
              <div className="text-[13px] text-slate-300">
                Confirming on Fetch.ai testnet…
              </div>
              <div className="text-[11px] text-slate-500">
                Broadcasting transaction
              </div>
            </motion.div>
          )}

          {phase === "confirmed" && (
            <motion.div
              key="confirmed"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={SPRING_BOUNCY}
              className="flex flex-col items-center gap-2 py-4"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ ...SPRING_BOUNCY, delay: 0.05 }}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-2xl"
              >
                ✓
              </motion.div>
              <div className="text-[14px] font-semibold text-emerald-300">
                Payment confirmed
              </div>
              <div className="text-[11px] text-slate-500">
                0.10 FET · Fetch.ai testnet
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-slate-300" : "text-slate-300"}>
        {value}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-9 w-9 animate-spin text-violet-400"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

function FetchAiLogo() {
  // Simplified Fetch.ai "F" mark
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 text-[15px] font-bold text-white shadow-md shadow-violet-900/40">
      F
    </div>
  );
}

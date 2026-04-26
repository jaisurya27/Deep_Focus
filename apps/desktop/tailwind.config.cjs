/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#020617",
        },
        emerald: {
          500: "#10b981",
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ['"Manrope"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 48px -12px rgba(0,0,0,0.7)",
      },
    },
  },
  plugins: [],
};

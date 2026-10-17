import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        butter: {
          50: "#FDFBF5",
          100: "#FAF6EE", // Primary Canvas Background
          200: "#F5EEDD",
          300: "#EDE3CC", // Dividers & Soft Borders
          400: "#DECFA8",
          500: "#CFBA85",
        },
        brown: {
          950: "#140C0E",
          900: "#1E1315", // Primary Deep Espresso Brown (Buttons, Main Headings)
          850: "#24171A",
          800: "#2C1A1E", // Secondary Dark Surfaces
          700: "#3D282D",
          600: "#5A4046",
          500: "#755B62", // Muted Text
          400: "#967E85",
          300: "#BFAFB4",
          200: "#DFD7D9",
          100: "#EFECEE",
        },
        shield: {
          emerald: "#10B981",
          amber: "#D97706",
          rose: "#E11D48",
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        'xs': '4px',
        'sm': '6px',
        DEFAULT: '8px',
        'md': '10px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '20px',
        '3xl': '24px',
        '4xl': '32px',
        'full': '9999px',
      },
      boxShadow: {
        'subtle': '0 1px 3px 0 rgba(30, 19, 21, 0.03), 0 1px 2px -1px rgba(30, 19, 21, 0.02)',
        'elevated': '0 8px 24px -4px rgba(30, 19, 21, 0.06), 0 2px 6px -2px rgba(30, 19, 21, 0.03)',
        'card-hover': '0 12px 32px -4px rgba(30, 19, 21, 0.08), 0 4px 12px -2px rgba(30, 19, 21, 0.04)',
        'modal': '0 24px 48px -12px rgba(30, 19, 21, 0.15), 0 8px 16px -6px rgba(30, 19, 21, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;

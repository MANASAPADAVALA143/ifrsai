import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // New design system colors
        'bg-light': '#f5f6fa',
        'orange-primary': '#f97316',
        'orange-light': '#fff7ed',
        'orange-border': '#fed7aa',
        'text-primary': '#1e293b',
        'text-secondary': '#475569',
        'text-muted': '#94a3b8',
        'border-default': '#e2e8f0',
        // Legacy colors (keeping for compatibility)
        navy: '#080F1E',
        navy2: '#0D1829',
        indigo: '#4F6EF7',
        'indigo-light': '#7B93FF',
        emerald: '#00C98D',
        amber: '#F5A623',
        text: '#E8EDF5',
        border: 'rgba(255,255,255,0.07)',
        card: 'rgba(255,255,255,0.03)',
        'card-hover': 'rgba(255,255,255,0.06)',
        // Semantic color aliases
        primary: '#f97316', // Orange - main brand color
        accent: '#f97316',  // Orange - accent color
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Monaco', 'Courier New', 'monospace'],
        heading: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(circle, var(--tw-gradient-stops))',
        'gradient-orange': 'linear-gradient(135deg, #f97316, #ef4444)',
        'gradient-pink': 'linear-gradient(135deg, #f97316, #ec4899)',
        'gradient-amber': 'linear-gradient(135deg, #f59e0b, #f97316)',
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.06)',
      },
      borderRadius: {
        'card': '14px',
      },
    },
  },
  plugins: [],
} satisfies Config;

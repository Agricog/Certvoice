import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        certvoice: {
          bg: '#0C0F14',
          surface: '#151920',
          'surface-2': '#1C2029',
          border: '#2A2F3A',
          text: '#E8ECF1',
          muted: '#7A8494',
          accent: '#3B82F6',
          green: '#22C55E',
          amber: '#F59E0B',
          red: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '12px',
      },
      animation: {
        'pulse-record': 'pulse-record 1.5s ease-in-out infinite',
        'pulse-process': 'pulse-process 1s ease-in-out infinite',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      keyframes: {
        'pulse-record': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.3)' },
          '50%': { boxShadow: '0 0 0 20px rgba(239, 68, 68, 0)' },
        },
        'pulse-process': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.3)' },
          '50%': { boxShadow: '0 0 0 15px rgba(245, 158, 11, 0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config

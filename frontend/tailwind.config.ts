import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'media',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        elevated: 'hsl(var(--elevated) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        fill: 'hsl(var(--fill) / <alpha-value>)',
        'fill-hover': 'hsl(var(--fill-hover) / <alpha-value>)',
        separator: 'hsl(var(--separator) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        'tertiary-foreground': 'hsl(var(--tertiary-foreground) / <alpha-value>)',
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        record: {
          DEFAULT: 'hsl(var(--record) / <alpha-value>)',
          foreground: 'hsl(var(--record-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        stage: 'hsl(var(--stage) / <alpha-value>)',
        hud: {
          DEFAULT: 'hsl(var(--hud) / <alpha-value>)',
          foreground: 'hsl(var(--hud-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        title:    ['15px', { lineHeight: '20px', fontWeight: '600' }],
        headline: ['13px', { lineHeight: '16px', fontWeight: '600' }],
        body:     ['13px', { lineHeight: '18px', fontWeight: '400' }],
        callout:  ['12px', { lineHeight: '16px', fontWeight: '400' }],
        caption:  ['11px', { lineHeight: '14px', fontWeight: '400' }],
        micro:    ['10px', { lineHeight: '12px', fontWeight: '500', letterSpacing: '0.06em' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        popover: 'var(--shadow-popover), inset 0 0 0 1px hsl(var(--foreground) / 0.08)',
        sheet: 'var(--shadow-sheet)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config

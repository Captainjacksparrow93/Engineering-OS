import type { Config } from 'tailwindcss';

/**
 * Design tokens from `design/cursor-design-system.md`.
 *
 * Every colour, radius, spacing step and type style in the app resolves to a token
 * here. Nothing in a component should carry a raw hex value or a stock Tailwind
 * palette class (`slate-500`, `red-600`, …) — see `docs/design-system.md`.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand voltage. Primary CTAs and the wordmark only — kept scarce.
        primary: {
          DEFAULT: '#f54e00',
          active: '#d04200',
        },
        'on-primary': '#ffffff',

        // Warm near-black ink, running body, and the two muted greys.
        ink: '#26251e',
        body: '#5a5852',
        muted: {
          DEFAULT: '#807d72',
          soft: '#a09c92',
        },

        // Warm cream page floor; white is a card surface, never the canvas.
        canvas: {
          DEFAULT: '#f7f7f4',
          soft: '#fafaf7',
        },
        surface: {
          DEFAULT: '#ffffff',
          strong: '#e6e5e0',
        },

        // Hairline-only depth. There are no shadow tokens on purpose.
        hairline: {
          DEFAULT: '#e6e5e0',
          soft: '#efeee8',
          strong: '#cfcdc4',
        },

        // Work-stage palette. Scoped to stage markers (task lifecycle, progress
        // timeline) — never to buttons, alerts or generic system state.
        stage: {
          thinking: '#dfa88f',
          grep: '#9fc9a2',
          read: '#9fbbe0',
          edit: '#c0a8dd',
          done: '#c08532',
        },

        success: '#1f8a65',
        error: '#cf2d56',
      },

      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        pill: '9999px',
      },

      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        base: '16px',
        md: '20px',
        lg: '24px',
        xl: '32px',
        xxl: '48px',
        section: '80px',
      },

      fontFamily: {
        // CursorGothic is licensed; Inter at 400 with negative tracking is the
        // documented substitute. Both faces are self-hosted via next/font.
        sans: ['var(--font-sans)', 'system-ui', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        'display-mega': ['72px', { lineHeight: '1.1', letterSpacing: '-2.16px', fontWeight: '400' }],
        'display-lg': ['36px', { lineHeight: '1.2', letterSpacing: '-0.72px', fontWeight: '400' }],
        'display-md': ['26px', { lineHeight: '1.25', letterSpacing: '-0.325px', fontWeight: '400' }],
        'display-sm': ['22px', { lineHeight: '1.3', letterSpacing: '-0.11px', fontWeight: '400' }],
        'title-md': ['18px', { lineHeight: '1.4', letterSpacing: '0', fontWeight: '600' }],
        'title-sm': ['16px', { lineHeight: '1.4', letterSpacing: '0', fontWeight: '600' }],
        'body-md': ['16px', { lineHeight: '1.5', letterSpacing: '0' }],
        'body-tracked': ['16px', { lineHeight: '1.5', letterSpacing: '0.08px' }],
        'body-sm': ['14px', { lineHeight: '1.5', letterSpacing: '0' }],
        caption: ['13px', { lineHeight: '1.4', letterSpacing: '0' }],
        'caption-uppercase': ['11px', { lineHeight: '1.4', letterSpacing: '0.88px', fontWeight: '600' }],
        code: ['13px', { lineHeight: '1.5', letterSpacing: '0' }],
        button: ['14px', { lineHeight: '1', letterSpacing: '0', fontWeight: '500' }],
        'nav-link': ['14px', { lineHeight: '1.4', letterSpacing: '0', fontWeight: '500' }],
      },

      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
};

export default config;

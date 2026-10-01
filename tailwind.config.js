export default {
  content: ['./src/ui/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
        },
        interactive: {
          DEFAULT: 'var(--interactive)',
          hover: 'var(--interactive-hover)',
          active: 'var(--interactive-active)',
        },
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          dim: 'var(--fg-dim)',
          faint: 'var(--fg-faint)',
          deco: 'var(--fg-deco)',
        },
        hairline: {
          DEFAULT: 'var(--hairline)',
          subtle: 'var(--hairline-subtle)',
          strong: 'var(--hairline-strong)',
        },
        cta: {
          DEFAULT: 'var(--cta)',
          hover: 'var(--cta-hover)',
          fg: 'var(--cta-fg)',
        },
        accent: {
          danger: 'var(--accent-danger)',
          warn: 'var(--accent-warn)',
          live: 'var(--accent-live)',
          'warn-strong': 'var(--accent-warn-strong)',
          'warn-strong-fg': 'var(--accent-warn-strong-fg)',
        },
        focus: 'var(--ring-focus)',
      },
    },
  },
  plugins: [],
}

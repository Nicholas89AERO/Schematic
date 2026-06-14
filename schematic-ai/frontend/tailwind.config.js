/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'aero-dark':   '#0d1117',
        'aero-panel':  '#161b22',
        'aero-border': '#30363d',
        'aero-accent': '#58a6ff',
        'aero-green':  '#3fb950',
        'aero-yellow': '#d29922',
        'aero-red':    '#f85149',
        'aero-orange': '#f0883e',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

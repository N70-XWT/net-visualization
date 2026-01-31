/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'deep-navy': '#0b1d3a',
        'aurora-green': '#5ef7c1',
      },
      boxShadow: {
        'soft-glow': '0 15px 45px rgba(8, 34, 68, 0.45)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

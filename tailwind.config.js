/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FCFBFF',
        surface: '#FFFFFF',
        subtle: '#F8F5FE',
        line: '#EEEAF5',
        outline: '#D4C9E5',
        ink: '#17152F',
        muted: '#62627A',
        success: '#16A34A',
        accent: {
          DEFAULT: '#7029D9',
          hover: '#6020BC',
          secondary: '#8B5CF6',
          soft: '#F3ECFF',
          line: '#DFCDF8',
        },
        danger: {
          DEFAULT: '#9a3435',
          hover: '#7f2628',
          soft: '#faedeb',
          line: '#e3b6b2',
        },
        warning: '#815716',
      },
      boxShadow: {
        soft: '0 4px 20px rgba(58, 30, 95, 0.035)',
      },
    },
  },
  plugins: [],
};

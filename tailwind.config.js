/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f7f8f6',
        surface: '#ffffff',
        subtle: '#eef1ef',
        line: '#dce3df',
        outline: '#a8b5af',
        ink: '#1f2b28',
        muted: '#52635c',
        accent: {
          DEFAULT: '#285d52',
          hover: '#1b483e',
          soft: '#e7f1ed',
          line: '#a4c2b8',
        },
        danger: {
          DEFAULT: '#9a3435',
          hover: '#7f2628',
          soft: '#faedeb',
          line: '#e3b6b2',
        },
        warning: '#815716',
      },
    },
  },
  plugins: [],
};

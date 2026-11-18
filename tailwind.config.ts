import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/ui/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        cmdBg: '#0C0C0C',
        cmdFg: '#CCCCCC',
        cmdBright: '#F2F2F2'
      },
      fontFamily: {
        cmd: ['"Cascadia Mono"', 'Consolas', '"Lucida Console"', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
// The plugin is imported rather than named by path: Turbopack requires string
// plugins from its own chunk directory (.next/build/chunks), where a relative
// './postcss/...' cannot resolve. It must sit after tailwindcss, which
// generates the font sizes, and before autoprefixer. See
// postcss/scale-type.mjs for why the pass exists at all.
import scaleType from './postcss/scale-type.mjs';

const config = {
  plugins: [['tailwindcss', {}], scaleType, ['autoprefixer', {}]],
};
export default config;

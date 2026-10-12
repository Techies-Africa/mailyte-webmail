/**
 * Makes every generated font-size and line-height follow --font-scale.
 *
 * Why a build pass instead of a Tailwind theme: type in this app is set with
 * arbitrary px utilities (`text-[12.5px]` and friends, ~280 of them across 54
 * files), so a :root font-size reaches none of it, and a named rem scale would
 * mean touching all 54 files -- and would silently stop working the next time
 * someone wrote `text-[13px]`, which is the house idiom. Rewriting Tailwind's
 * OUTPUT catches every utility, old and new, for free.
 *
 * Runs after tailwindcss and before autoprefixer (postcss.config.mjs).
 *
 * line-height is scaled alongside font-size on purpose: Tailwind emits
 * `line-height: 1.25rem` next to `font-size: 0.875rem`, and scaling only the
 * first would crush the leading at larger sizes.
 *
 * Deliberately skipped:
 *   !important        -- app/globals.css forces 16px on fields under iOS
 *                        WebKit to stop the page zooming on focus. Scaling
 *                        that down would bring the zoom back, so it is left
 *                        exactly as it is.
 *   unitless, em, %   -- already relative; they follow their parent.
 *
 * OnceExit, not the Declaration visitor: the AST is walked a single time after
 * Tailwind has generated its utilities, so a rewritten declaration can never
 * be re-visited and double-wrapped.
 */
const SCALABLE = /^-?[\d.]+(px|rem)$/;

const plugin = () => ({
  postcssPlugin: 'mailyte-scale-type',
  OnceExit(root) {
    root.walkDecls((decl) => {
      if (decl.prop !== 'font-size' && decl.prop !== 'line-height') return;
      if (decl.important) return;
      const value = decl.value.trim();
      if (!SCALABLE.test(value)) return;
      decl.value = `calc(${value} * var(--font-scale, 1))`;
    });
  },
});

plugin.postcss = true;

export default plugin;

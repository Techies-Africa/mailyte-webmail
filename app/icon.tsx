import { ImageResponse } from 'next/og';
import { brand } from '@/lib/webmail/brand';

/**
 * The browser-tab icon, drawn from the deployment's own brand mark.
 *
 * There was no icon at all before -- no app/icon.*, nothing in public/ -- so
 * every tab fell back to the browser's blank-page glyph.
 *
 * Generated rather than shipped as a file, to match the decision in
 * lib/webmail/brand.ts: branding here is a character and a name, not an
 * asset, so that rebranding is an environment variable and never a file
 * someone has to remember to replace. Setting NEXT_PUBLIC_BRAND_MARK changes
 * the favicon along with everything else.
 *
 * Build-time, like the rest of NEXT_PUBLIC_* branding.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // #DBA500 -- the literal value of --primary in globals.css. A CSS
          // variable cannot reach this renderer, and a favicon that silently
          // drew on a transparent background would be invisible against a
          // dark tab strip.
          background: '#DBA500',
          color: '#1a1a1a',
          fontSize: brand.mark.length > 1 ? 16 : 22,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        {brand.mark}
      </div>
    ),
    size,
  );
}

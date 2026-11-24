'use client';

import { useEffect, useState } from 'react';
import { brand } from '@/lib/webmail/brand';
import { ownStore, storeLinks, type StoreLink } from '@/lib/webmail/appLinks';

/**
 * "Get the app", small store icons, low in the rail.
 *
 * Deliberately quiet: the words are the same muted white as the theme switch
 * beside it, and the icons are a touch dimmed until hovered, so it reads as part
 * of the rail rather than an advert. Where it sits (just above the theme switch)
 * is where the eye goes to find account things, not mail. Left out of the
 * icon-only rail, and entirely when this build has no store links.
 *
 * On a phone or tablet it shows only that device's store (an iPhone has no use
 * for the Google Play icon), and then a little bigger, since it is the only
 * thing in the row. Anywhere else, or where the device cannot be told, both show.
 */
export default function AppLinks() {
  // Both until the browser has been asked: the server cannot know the device, and
  // the first render has to match what the server sent. The rail is a closed
  // drawer on a phone, so nobody sees the second step.
  const [own, setOwn] = useState<StoreLink['id'] | null>(null);
  useEffect(() => setOwn(ownStore()), []);

  const all = storeLinks();
  const mine = all.filter((store) => store.id === own);
  // A device whose store has no link configured still gets the ones that exist.
  const stores = mine.length > 0 ? mine : all;
  if (stores.length === 0) return null;
  const single = stores.length === 1;

  return (
    <div className="mb-1 flex items-center justify-between gap-2 px-2.5 py-0.5">
      <span className="min-w-0 truncate text-[12px] font-medium text-white/50">Get the app</span>
      <ul aria-label={`Get the ${brand.name} app`} className="flex shrink-0 items-center gap-0.5">
        {stores.map((store) => (
          <li key={store.id}>
            <a
              href={store.href}
              target="_blank"
              rel="noopener noreferrer"
              title={store.label}
              aria-label={store.label}
              className={`flex items-center justify-center rounded-md opacity-75 transition hover:bg-white/[0.08] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                single ? 'h-10 w-10' : 'h-8 w-8'
              }`}
            >
              <img
                src={store.logo}
                alt=""
                width={single ? 30 : 24}
                height={single ? 30 : 24}
                draggable={false}
                className={single ? 'h-[30px] w-[30px]' : 'h-6 w-6'}
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

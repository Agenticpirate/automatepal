'use client';
/* Our own support widget on our own marketing pages (Phase 6). The install key comes from SUPPORT_BOT_KEY on the
   server (app/layout.tsx); without it nothing loads. Loaded the way any customer loads it: /widget.js with
   data-bot. The script element is created here because the site's CSP ('strict-dynamic') only runs scripts added
   by an already trusted script. Dashboard, sign-in and widget routes never show it: the chat button is hidden when
   client-side navigation leaves the marketing pages and shown again on return. */
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
const KEY = /^pk_(live|test)_[A-Za-z0-9]{24}$/;
const MARKETING = ['/', '/pricing', '/docs', '/contact', '/security', '/privacy', '/terms', '/status', '/integrations'];
export const marketingPath = (p: string) => MARKETING.includes(p) || p.startsWith('/legal/') || p === '/legal';
export default function SupportWidget({botKey}: {botKey: string | null}) {
  const pathname = usePathname() ?? '/';
  useEffect(() => {
    if (!botKey || !KEY.test(botKey)) return;
    const show = marketingPath(pathname), host = document.getElementById('automatepal-billing-widget');
    if (host) { host.style.display = show ? '' : 'none'; return; }
    if (!show || document.querySelector('script[data-own-support]')) return;
    const s = document.createElement('script');
    s.src = '/widget.js'; s.async = true; s.setAttribute('data-bot', botKey); s.setAttribute('data-own-support', '');
    document.body.appendChild(s);
  }, [botKey, pathname]);
  return null;
}

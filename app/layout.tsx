import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
// The root error and not-found screens render PublicShell, so Next preloads its stylesheet on every route and
// warns when a page never uses it. Loading it here (every selector is scoped under .ps) removes the unused preload.
import "./components/public-shell.css";
import { connection } from "next/server";
import { SITE_URL } from "../lib/site";
import { modeText } from "../lib/app-mode";
import SupportWidget from "./components/SupportWidget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Self-hosted at build time (no request to Google's font CDN, so the CSP stays first-party).
// preload:false: the files download only on pages that use them (home hero, pricing accent).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", preload: false });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap", preload: false });

export const metadata: Metadata = {
 metadataBase:new URL(SITE_URL),
 title:{default:'AutomatePal: AI customer support that shows its work',template:'%s | AutomatePal'},
 keywords:['AI customer support','AI chatbot for website','customer support chatbot','AI help desk','support widget','AutomatePal'],
 description:'AI customer support chatbot trained on your website and help docs. Every answer quotes its source, and your team takes over refunds and edge cases. '+modeText('Fictional-data preview. No live payments.','Free to start.'),
 alternates:{canonical:'/'},
 openGraph:{type:'website',siteName:'AutomatePal',url:'/',title:'AutomatePal: AI customer support that shows its work',description:'An AI support agent for your website that answers in seconds, quotes the exact source and hands the rest to your team. '+modeText('Fictional-data preview, no live payments.','Free to start.'),images:[{url:'/opengraph-image',width:1200,height:630,alt:modeText('AutomatePal: AI support that shows its work, fictional-data preview','AutomatePal: AI support that shows its work')}]},
 twitter:{card:'summary_large_image',title:'AutomatePal: AI customer support that shows its work',description:'An AI support agent for your website that answers in seconds, quotes the exact source and hands the rest to your team. '+modeText('Fictional-data preview, no live payments.','Free to start.'),images:['/opengraph-image']},
 // Public pages stay indexable in both demo modes so search engines can list the site and its favicon.
 // App surfaces that show demo fixtures keep their X-Robots-Tag noindex headers (next.config.ts).
 robots:{index:true,follow:true},
};

// Brand navy tints the mobile browser address bar (Chrome on Android, Safari).
// Zoom stays enabled (no maximum-scale). The keyboard resizes the layout on Android so pinned composers stay
// above it, as they already do on iOS. One light brand theme, so form controls never switch to dark styling.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#041A52',
  colorScheme: 'light',
  interactiveWidget: 'resizes-content',
};

// Every page renders per request, so each response carries the fresh CSP nonce from proxy.ts (a page
// prerendered at build time would have no nonce and its scripts would be blocked).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Keyboard users jump past the navigation. Pages put id="main-content" on their main region. */}
        <a href="#main-content" className="ap-skip">Skip to content</a>
        {children}
        {/* Our own chat widget on the marketing pages; off until SUPPORT_BOT_KEY is set. */}
        <SupportWidget botKey={process.env.SUPPORT_BOT_KEY ?? null} />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
 metadataBase:new URL('https://automatepal.onrender.com'),
 title:{default:'AutomatePal - source-backed support preview',template:'%s | AutomatePal'},
 description:'Explore source-backed answers, owner-reviewed service desk workflows and PayPal sandbox plan evidence. Fictional-data preview. No live payments.',
 alternates:{canonical:'/'},
 openGraph:{type:'website',siteName:'AutomatePal',url:'/',title:'AutomatePal - support with a clear next step',description:'Source-backed answers and owner review. Fictional-data preview, no live payments.',images:[{url:'/opengraph-image',width:1200,height:630,alt:'AutomatePal: source-backed answers, owner review, fictional-data preview'}]},
 twitter:{card:'summary_large_image',title:'AutomatePal - source-backed support preview',description:'Source-backed answers and owner review. Fictional-data preview, no live payments.',images:['/opengraph-image']},
 // Public pages stay indexable in both demo modes so search engines can list the site and its favicon.
 // App surfaces that show demo fixtures keep their X-Robots-Tag noindex headers (next.config.ts).
 robots:{index:true,follow:true},
};

// Brand navy tints the mobile browser address bar (Chrome on Android, Safari).
export const viewport: Viewport = { themeColor: '#041A52' };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

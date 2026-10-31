/* Public site identity in one place. Set NEXT_PUBLIC_SITE_URL (e.g. https://automatepal.com) once the
   custom domain serves the app; canonical URLs, the sitemap, robots.txt and structured data follow it. */
export const SITE_URL=(process.env.NEXT_PUBLIC_SITE_URL||'https://automatepal.onrender.com').replace(/\/+$/,'');
/* The only contact address used anywhere on the site (support, privacy, deletion, security, abuse). */
export const CONTACT_EMAIL='raviteja@automatepal.com';
export const REPO_URL='https://github.com/Agenticpirate/automatepal';
export const COPYRIGHT_HOLDER='Ravi Teja P';

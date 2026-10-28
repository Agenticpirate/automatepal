# Open-source reference ledger

The AutomatePal application is original MIT code. References checked October28,2026:

- Supabase repository, Apache License2.0: https://github.com/supabase/supabase/blob/master/LICENSE . Its semantic-search documentation informed the pgvector distance/RPC approach: https://supabase.com/docs/guides/functions/examples/semantic-search . Tenant capability routing and SQL in this application are original, not copied wholesale.
- promptfoo, MIT: https://github.com/promptfoo/promptfoo/blob/main/LICENSE . Evaluated as a possible test runner; not installed or bundled. The current small eval runner is original TypeScript, not promptfoo and not a claim of equivalent coverage.

No SiteGPT code, assets, brand or proprietary prompts were copied. Its public feature list was used only to identify product categories: https://sitegpt.ai/features . No claim of feature parity or enterprise certification is made.

## Bundled PDF parser

PDF.js/pdfjs-dist6.4.299 (Mozilla contributors), Apache License2.0, is used for browser-side text extraction. Package metadata and the source license were checked. The unmodified worker is in `public/pdf.worker.min.mjs`; its license is served at `/licenses/pdfjs-dist/LICENSE.txt`. No NOTICE file was present in the installed package. Library license: https://github.com/mozilla/pdfjs-dist/blob/master/LICENSE . Package: https://www.npmjs.com/package/pdfjs-dist . Embedded PDF actions/scripts are not invoked; only `getTextContent` is used. This is not OCR or a security certification.

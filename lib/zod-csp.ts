/* zod 4 probes `new Function` to decide whether it may compile fast parsers. Under the nonce-based CSP
   (no 'unsafe-eval') that probe is a CSP violation in the browser, so schemas run in jitless mode everywhere.
   Imported for its side effect by every lib module that defines zod schemas. */
import {z} from 'zod';
z.config({jitless:true});

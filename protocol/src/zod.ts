import { z } from "zod";

// An extension page's CSP blocks the `new Function` probe zod runs on its first object-schema build
z.config({ jitless: true });

export { z };

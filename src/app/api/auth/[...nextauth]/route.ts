import { handlers } from "@/lib/auth";
import { gatedHandlers } from "@/lib/write-gate";

// Card #314: sign-in writes (failed attempts, the login log), so it holds the write gate too.
export const { GET, POST } = gatedHandlers(handlers);

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createAtsEmailHandler } from "./handler.mjs";

// HighCall Careers (ATS) candidate emails. Separate from DeviceCare's process-action-emails.
// verify_jwt is off at the gateway (same approach as DeviceCare); the handler verifies the
// user's session with Auth and requires public.ats_is_recruiter() before sending anything.
Deno.serve(createAtsEmailHandler({ env: (name: string) => Deno.env.get(name), createClient }));

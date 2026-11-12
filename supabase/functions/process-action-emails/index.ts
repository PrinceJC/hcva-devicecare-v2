import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2.118.0/cors";
import { createEmailHandler } from "../_shared/email-worker.mjs";

// verify_jwt is disabled at the gateway because this handler supports both
// signed-in IT admins and a dedicated Cron secret. The handler itself verifies
// user JWTs with Auth and checks the database admin role before any queue work.
Deno.serve(
  createEmailHandler({
    env: (name: string) => Deno.env.get(name),
    createClient,
    corsHeaders,
  }),
);

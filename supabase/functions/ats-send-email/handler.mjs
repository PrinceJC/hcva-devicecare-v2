// HighCall Careers: send one candidate email through Resend.
// Dependency-injected so it can be tested without sending real email.
// Only signed-in ATS recruiters (public.ats_is_recruiter()) can send.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export function fill(text, vars) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" style="color:#17775A;text-decoration:underline">${u}</a>`);
}

// Branded, email-client-safe HTML (tables + inline styles).
export function renderHtml(bodyText, { logoUrl, footer, preheader }) {
  const paras = String(bodyText).trim().split(/\n\s*\n/).map((p) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2E4444">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HighCall VA</title></head>
<body style="margin:0;padding:0;background:#F4F7F6;font-family:Figtree,Segoe UI,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || "")}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F6;padding:28px 12px"><tr><td align="center">
 <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #DFE7E4;border-radius:12px;overflow:hidden">
  <tr><td style="background:#123333;padding:22px 28px">
   <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    ${logoUrl ? `<td style="padding-right:12px;vertical-align:middle"><img src="${esc(logoUrl)}" width="56" alt="HighCall VA" style="display:block;border:0;width:56px;height:auto"></td>` : ""}
    <td style="vertical-align:middle"><div style="color:#FFFFFF;font-size:19px;font-weight:800;line-height:1.1">HighCall Careers</div>
     <div style="color:#C9D8D5;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:4px">HighCall Virtual Assistants</div></td>
   </tr></table></td></tr>
  <tr><td style="height:4px;background:#A6D436;background:linear-gradient(90deg,#A6D436,#8DD98E,#6FE3EC);line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td style="padding:30px 28px 14px">${paras}</td></tr>
  <tr><td style="padding:18px 28px 24px;border-top:1px solid #DFE7E4;color:#6A7E7B;font-size:12px;line-height:1.5">${esc(footer || "HighCall Virtual Assistants")}</td></tr>
 </table>
</td></tr></table></body></html>`;
}

export function createAtsEmailHandler({ env, createClient, fetchImpl = fetch }) {
  return async function handler(request) {
    const origin = request.headers.get("origin");
    const allowed = env("ATS_APP_ORIGIN");
    const local = env("ATS_ALLOW_LOCALHOST") === "true" && /^http:\/\/localhost:\d+$/.test(origin || "");
    const cors = origin && (origin === allowed || local) ? {
      "Access-Control-Allow-Origin": origin, Vary: "Origin",
      "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    } : {};
    const reply = (status, value) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (origin && origin !== allowed && !local) return reply(403, { error: "This application origin is not allowed." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { error: "POST required" });

    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!bearer) return reply(401, { error: "Please sign in again." });
    const url = env("SUPABASE_URL");
    const publicKey = env("ATS_PUBLISHABLE_KEY") || env("DEVICECARE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
    const secretKey = env("ATS_SECRET_KEY") || env("DEVICECARE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publicKey || !secretKey) return reply(503, { error: "Server credentials are not configured." });

    try {
      const userClient = createClient(url, publicKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: who, error: whoErr } = await userClient.auth.getUser(bearer);
      if (whoErr || !who?.user) return reply(401, { error: "Please sign in again." });
      const role = await userClient.rpc("ats_is_recruiter");
      if (role.error || role.data !== true) return reply(403, { error: "Recruiter access required." });

      const raw = await request.text();
      if (raw.length > 60000) return reply(400, { error: "Email is too long." });
      let input; try { input = raw ? JSON.parse(raw) : {}; } catch { return reply(400, { error: "Invalid request." }); }
      const subjectIn = String(input.subject || "").trim(), bodyIn = String(input.body || "").trim();
      if (!subjectIn || subjectIn.length > 200 || /[\r\n]/.test(subjectIn)) return reply(400, { error: "Enter a one-line subject of up to 200 characters." });
      if (!bodyIn || bodyIn.length > 20000) return reply(400, { error: "Write the email message (up to 20,000 characters)." });
      for (const k of ["candidate_id", "pipeline_id", "template_id"]) if (input[k] && !UUID.test(input[k])) return reply(400, { error: "Invalid request." });

      const service = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const brand = (await service.from("ats_settings").select("value").eq("key", "email_branding").maybeSingle()).data?.value || {};
      const fromEmail = String(brand.from_email || "").trim(), replyTo = String(brand.reply_to || "").trim();
      if (!EMAIL.test(fromEmail)) return reply(400, { error: "Set the sender email in Settings, Email sender first." });
      if (replyTo && !EMAIL.test(replyTo)) return reply(400, { error: "The reply-to address in Settings isn’t valid." });
      const apiKey = env("RESEND_API_KEY");
      if (!apiKey) return reply(503, { error: "Email sending isn’t set up on the server (RESEND_API_KEY)." });
      const appOrigin = (allowed || "").replace(/\/$/, "");
      const logoUrl = env("ATS_EMAIL_LOGO_URL") || (appOrigin ? `${appOrigin}/email-logo.png` : "");
      const fromName = String(brand.from_name || "HighCall VA Careers").replace(/[<>"\r\n]/g, "").slice(0, 80);

      const staff = (await service.from("ats_staff").select("name,email").eq("user_id", who.user.id).maybeSingle()).data;
      const recruiterName = staff?.name || staff?.email || who.user.email || "HighCall VA Recruitment";

      const send = async (to, subject, text, idem) => {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idem },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`, to: [to], ...(replyTo ? { reply_to: replyTo } : {}),
            subject, text, html: renderHtml(text, { logoUrl, footer: brand.footer, preheader: text.split("\n").find((l) => l.trim() && !/^hi\b/i.test(l.trim())) || "" }),
          }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.id === "string") return { id: data.id };
        return { error: `Email provider returned ${res.status}: ${String(data.message || "no confirmation").slice(0, 300)}` };
      };

      // Test email to the recruiter themselves (template check).
      if (input.test) {
        const to = who.user.email;
        if (!EMAIL.test(to || "")) return reply(400, { error: "Your account has no email address." });
        const vars = { first_name: "Maria", full_name: "Maria Santos", role: "Appointment Setter", recruiter_name: recruiterName, recruiter_email: to, company: "HighCall VA" };
        const out = await send(to, "[Test] " + fill(subjectIn, vars), fill(bodyIn, vars), `ats-test/${crypto.randomUUID()}`);
        return out.id ? reply(200, { status: "sent", test: true, to }) : reply(502, { error: out.error });
      }

      if (!UUID.test(input.candidate_id || "")) return reply(400, { error: "Choose a candidate." });
      const cand = (await service.from("ats_candidates").select("id,name,email").eq("id", input.candidate_id).maybeSingle()).data;
      if (!cand) return reply(404, { error: "Candidate not found." });
      const to = String(cand.email || "").trim();
      if (!EMAIL.test(to)) return reply(400, { error: "This candidate has no valid email address." });
      let pipe = null, roleTitle = "";
      if (input.pipeline_id) {
        pipe = (await service.from("ats_pipeline").select("id,candidate_id,role_id,stage").eq("id", input.pipeline_id).maybeSingle()).data;
        if (!pipe || pipe.candidate_id !== cand.id) return reply(400, { error: "That role entry doesn’t belong to this candidate." });
        if (pipe.role_id) roleTitle = (await service.from("ats_roles").select("title").eq("id", pipe.role_id).maybeSingle()).data?.title || "";
      }
      const vars = {
        first_name: String(cand.name || "").trim().split(/\s+/)[0] || "there", full_name: cand.name || "", role: roleTitle || "the role",
        recruiter_name: recruiterName, recruiter_email: staff?.email || who.user.email || "", company: "HighCall VA",
      };
      const subject = fill(subjectIn, vars).replace(/[\r\n]+/g, " ").slice(0, 200), text = fill(bodyIn, vars);

      const logged = await service.from("ats_emails").insert({
        candidate_id: cand.id, pipeline_id: pipe?.id || null, role_id: pipe?.role_id || null, stage: pipe?.stage || null,
        template_id: input.template_id || null, to_email: to, subject, body_text: text, status: "sending", sent_by: who.user.id,
      }).select("id").single();
      if (logged.error) throw new Error("Could not record the email.");
      let out;
      try { out = await send(to, subject, text, `ats-email/${logged.data.id}`); }
      catch { out = { error: "Couldn’t reach the email provider. Try again in a moment." }; }
      await service.from("ats_emails").update(out.id ? { status: "sent", provider_id: out.id } : { status: "failed", error: out.error }).eq("id", logged.data.id);
      return out.id ? reply(200, { status: "sent", id: logged.data.id }) : reply(502, { error: out.error, id: logged.data.id });
    } catch (error) {
      return reply(500, { error: error instanceof Error ? error.message : "Email could not be sent." });
    }
  };
}

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

// The auth callback only updates session state. Role checks run in a separate
// effect keyed by user ID, so same-user SIGNED_IN / TOKEN_REFRESHED events
// never reset access or unmount an open screen.
export default function useAdminSession(client = supabase) {
  const [auth, setAuth] = useState({ ready: false, session: null, error: "" });
  const [access, setAccess] = useState({
    userId: null,
    status: "checking",
    error: "",
  });
  const [retry, setRetry] = useState(0);
  const userId = auth.session?.user?.id || null;

  useEffect(() => {
    let active = true;
    let receivedEvent = false;

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      receivedEvent = true;
      if (active) setAuth({ ready: true, session, error: "" });
    });

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || receivedEvent) return;
        setAuth({
          ready: true,
          session: data?.session || null,
          error: error?.message || "",
        });
      })
      .catch((error) => {
        if (active && !receivedEvent)
          setAuth({ ready: true, session: null, error: error.message });
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setAccess({ userId: null, status: "checking", error: "" });
      return () => {
        active = false;
      };
    }

    setAccess({ userId, status: "checking", error: "" });
    async function check() {
      try {
        const { data, error } = await client.rpc("devicecare_is_admin");
        if (error) throw error;
        if (active)
          setAccess({
            userId,
            status: data === true ? "admin" : "denied",
            error: "",
          });
      } catch (error) {
        if (active)
          setAccess({
            userId,
            status: "error",
            error: error.message || "Could not verify access.",
          });
      }
    }
    check();
    return () => {
      active = false;
    };
  }, [client, userId, retry]);

  let status = "loading";
  if (auth.ready) {
    if (!userId) status = "signed-out";
    else if (access.userId === userId) status = access.status;
  }

  return {
    session: auth.session,
    status,
    error: userId ? access.error : auth.error,
    retryAccess: () => setRetry((value) => value + 1),
  };
}

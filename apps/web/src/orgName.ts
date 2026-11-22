import { useEffect, useState } from "react";
import { getOrgName } from "./api.js";

type Named = { org: string; name: string };

export function orgNameOf(view: { orgName?: string | undefined } | null, org: string): string | null {
  return view === null ? null : (view.orgName ?? org);
}

export function useOrgName(org: string): string | null {
  const [named, setNamed] = useState<Named | null>(null);
  useEffect(() => {
    let current = true;
    void getOrgName(org).then((outcome) => {
      if (!current) return;
      if (!outcome.ok) console.warn(`about: the organisation name did not load (${outcome.code})`);
      setNamed({ org, name: outcome.ok ? outcome.orgName : org });
    });
    return () => {
      current = false;
    };
  }, [org]);
  return named?.org === org ? named.name : null;
}

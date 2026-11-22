import { useCallback, useMemo } from "react";
import type { Command, LedgerEvent } from "@vision/contracts";
import {
  askGoogle,
  createJoinCode,
  getLedger,
  sendCommand,
  type Auth,
  type GoogleAction,
  type GoogleOutcome,
} from "../api.js";
import type { DeskSend } from "../components/deskCommand.js";
import type { MakeJoinCode } from "../components/PeopleTable/PeopleTable.js";
import { resourcesClient, type ResourcesClient } from "../resourcesApi.js";

export type LoadLedger = () => Promise<LedgerEvent[]>;
export type AskGoogle = (action: GoogleAction, body: Record<string, unknown>) => Promise<GoogleOutcome>;

export type OrgActions = {
  send: DeskSend;
  loadLedger: LoadLedger;
  makeCode: MakeJoinCode;
  google: AskGoogle;
  resources: ResourcesClient;
};

export function useOrgActions(org: string, token: string, auth: Auth, refresh: () => void): OrgActions {
  const send = useCallback<DeskSend>(
    async (command: Command) => {
      const outcome = await sendCommand(org, auth, command);
      if (outcome.ok) refresh();
      return outcome;
    },
    [org, auth, refresh],
  );
  const loadLedger = useCallback(() => getLedger(org, token), [org, token]);
  const makeCode = useCallback<MakeJoinCode>((member) => createJoinCode(org, token, member), [org, token]);
  const google = useCallback<AskGoogle>(
    async (action, body) => {
      const outcome = await askGoogle(org, token, action, body);
      if (outcome.ok) refresh();
      return outcome;
    },
    [org, token, refresh],
  );
  const resources = useMemo(() => resourcesClient(org, auth), [org, auth]);
  return useMemo(
    () => ({ send, loadLedger, makeCode, google, resources }),
    [send, loadLedger, makeCode, google, resources],
  );
}

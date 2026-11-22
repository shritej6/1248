import type { DeskJob } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { dateTime } from "../clockTime.js";
import styles from "./JobRow.module.css";

const cx = classNames(styles);

type Answer = NonNullable<DeskJob["partnerAnswer"]>;

export function partnerAnswerWords(answer: Answer): string | null {
  if (answer.answer === "yes" && answer.reason === null) return null;
  const said = `${answer.partnerName} said ${answer.answer}`;
  const withReason = answer.reason === null ? said : `${said}: ${answer.reason}`;
  return answer.waitUntil === null
    ? withReason
    : `${withReason}. Ask again after ${dateTime(answer.waitUntil)}`;
}

export function PartnerAnswerLine({ job }: { job: DeskJob }) {
  const answer = job.partnerAnswer ?? null;
  const words = answer === null ? null : partnerAnswerWords(answer);
  return words === null ? null : <span className={cx("note")}>{words}</span>;
}

import { classNames } from "../classNames.js";
import styles from "./PromiseText.module.css";

const cx = classNames(styles);

export const FORGET_DAYS = 90;

const linesFor = (orgName: string | null): { label: string; text: string }[] => [
  {
    label: "What we share",
    text: "The first name, the ZIP code, the need, how to reach the person and what was tried.",
  },
  {
    label: "Why",
    text: "So that you can contact the person and help with this one need. Use it only for this request.",
  },
  {
    label: "For how long",
    text: `Keep it until the request closes, plus ${String(FORGET_DAYS)} days. Then delete it.`,
  },
  {
    label: "On request",
    text: `If the person or ${orgName ?? "the group that sent this"} asks, you delete it at once.`,
  },
];

export function PromiseText({ titleId, orgName }: { titleId: string; orgName: string | null }) {
  return (
    <div className={cx("promise")}>
      <h2 id={titleId} className={cx("heading")}>
        The promise
      </h2>
      <dl className={cx("lines")}>
        {linesFor(orgName).map((line) => (
          <div key={line.label} className={cx("line")}>
            <dt className={cx("label")}>{line.label}</dt>
            <dd className={cx("text")}>{line.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

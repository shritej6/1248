import { classNames } from "../classNames.js";
import styles from "./Call911.module.css";

const cx = classNames(styles);

export type Call911Props = { danger?: string; call?: string };

export function Call911({ danger = "In danger now?", call = "Call 911." }: Call911Props) {
  return (
    <p className={cx("box")}>
      {danger} <strong className={cx("call")}>{call}</strong>
    </p>
  );
}

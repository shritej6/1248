import { Button } from "react-aria-components";
import type { Theme } from "../../router.js";
import { classNames } from "../classNames.js";
import styles from "./Offline.module.css";

const cx = classNames(styles);

export type OfflineProps = { theme: Theme; onRetry: () => void };

const WORDS: Record<Theme, { text: string; button: string }> = {
  graphite: { text: "Offline. Actions are paused. Clocks show last sync.", button: "Retry" },
  paper: {
    text: "No connection. We keep trying. This page updates when the connection is back.",
    button: "Try again",
  },
};

export function Offline({ theme, onRetry }: OfflineProps) {
  const words = WORDS[theme];
  return (
    <div className={cx(theme)} role="alert">
      <p>{words.text}</p>
      <Button className={cx("retry")} onPress={onRetry}>
        {words.button}
      </Button>
    </div>
  );
}

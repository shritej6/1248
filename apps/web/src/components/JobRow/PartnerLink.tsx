import { useState } from "react";
import { Button } from "react-aria-components";
import { classNames } from "../classNames.js";
import styles from "./JobRow.module.css";

const cx = classNames(styles);

type CopyState = "idle" | "copied" | "failed";

export function PartnerLink({ link }: { link: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const url = `${window.location.origin}${link}`;
  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(
        (): CopyState => "copied",
        (): CopyState => "failed",
      )
      .then(setState);
  };
  return (
    <span className={cx("partnerLink")}>
      <Button className={cx("secondary")} onPress={copy}>
        Copy partner link
      </Button>
      {state === "copied" ? <span className={cx("note")}>Copied</span> : null}
      {state === "failed" ? (
        <>
          <span role="alert" className={cx("error")}>
            Not copied. Select the link and copy it by hand.
          </span>
          <code className={cx("link")}>{url}</code>
        </>
      ) : null}
    </span>
  );
}

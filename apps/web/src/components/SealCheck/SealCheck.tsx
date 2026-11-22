import { useState } from "react";
import { Button } from "react-aria-components";
import type { LedgerEvent } from "@vision/contracts";
import { verifySeal, type SealCheck as SealResult } from "@vision/core";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import styles from "./SealCheck.module.css";

const cx = classNames(styles);

function SealWords({ result }: { result: SealResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className={cx("crit")}>
        <span className={cx("words")}>
          <ShapeMark mark="triangle" />
          <span>{`The seal is broken at line ${String(result.badSeq)}.`}</span>
        </span>
      </p>
    );
  }
  return (
    <p role="status" className={cx("ok")}>
      <span className={cx("words")}>
        <ShapeMark mark="hollow_check" />
        <span>{`The seal holds for all ${String(result.seq)} lines.`}</span>
      </span>
      {result.seq > 0 ? <code className={cx("hash")}>{result.hash}</code> : null}
    </p>
  );
}

export function SealCheck({ events }: { events: readonly LedgerEvent[] }) {
  const [result, setResult] = useState<SealResult | null>(null);
  return (
    <section className={cx("seal")} aria-label="Seal check">
      <p className={cx("hint")}>This browser checks every line of the ledger again. The hub is not asked.</p>
      <Button
        className={cx("secondary")}
        onPress={() => {
          setResult(verifySeal(events));
        }}
      >
        Check the seal
      </Button>
      {result === null ? null : <SealWords result={result} />}
    </section>
  );
}

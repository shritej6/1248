import type { DeskJob } from "@vision/contracts";
import { JOB_STATES, StateChip } from "../StateChip/StateChip.js";
import { classNames } from "../classNames.js";
import styles from "./ShelfList.module.css";

const cx = classNames(styles);

type FinishJob = DeskJob & { daysSinceTap: number };

const holderWords = (job: DeskJob): string =>
  job.holder.name ?? (job.holder.kind === "none" ? "No one" : job.holder.kind);

function JobCells({ job }: { job: DeskJob }) {
  return (
    <>
      <td className={cx("cell", "code")}>{job.routeCode}</td>
      <td className={cx("cell")}>{job.needLabel}</td>
      <td className={cx("cell")}>
        <StateChip state={JOB_STATES[job.status]} />
      </td>
      <td className={cx("cell")}>{holderWords(job)}</td>
    </>
  );
}

const HEADS = ["Code", "Need", "State", "Held by"];

export function UnmetShelf({ jobs }: { jobs: DeskJob[] }) {
  if (jobs.length === 0) return <p className={cx("empty")}>The unmet shelf is empty</p>;
  return (
    <table className={cx("table")} aria-label="Unmet shelf">
      <thead>
        <tr>
          {[...HEADS, "Why"].map((head) => (
            <th key={head} className={cx("head")}>
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.job} className={cx("row")}>
            <JobCells job={job} />
            <td className={cx("cell")}>{job.returnReason ?? "Every path was tried"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FinishList({ jobs }: { jobs: FinishJob[] }) {
  if (jobs.length === 0) return <p className={cx("empty")}>No job waits to be finished</p>;
  return (
    <table className={cx("table")} aria-label="Finish list">
      <thead>
        <tr>
          {HEADS.map((head) => (
            <th key={head} className={cx("head")}>
              {head}
            </th>
          ))}
          <th className={cx("head", "right")}>Days since last tap</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.job} className={cx("row")}>
            <JobCells job={job} />
            <td className={cx("cell", "num")}>{String(job.daysSinceTap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

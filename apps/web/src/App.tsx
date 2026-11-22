import { lazy, Suspense } from "react";
import { classNames } from "./components/classNames.js";
import { Shell } from "./components/Shell/Shell.js";
import { AskPage } from "./pages/AskPage.js";
import { DeskPage } from "./pages/DeskPage.js";
import { JoinPage } from "./pages/JoinPage.js";
import { PartnerPage } from "./pages/PartnerPage.js";
import { TrackPage } from "./pages/TrackPage.js";
import type { Route } from "./router.js";
import styles from "./App.module.css";

const cx = classNames(styles);

const OrgPage = lazy(async () => {
  const module = await import("./pages/OrgPage.js");
  return { default: module.OrgPage };
});

function OrgLoading() {
  return (
    <Shell theme="graphite" section="Organiser" live={null} clock={null} orgName={null}>
      <p className={cx("page")} role="status">
        Loading
      </p>
    </Shell>
  );
}

export function NotFound() {
  return (
    <Shell theme="paper" section={null} live={null} clock={null} orgName={null}>
      <section className={cx("page")}>
        <h1 className={cx("title")}>Page not found</h1>
        <p>Check the link you were sent.</p>
        <p>
          In danger now? <span className={cx("call")}>Call 911.</span>
        </p>
      </section>
    </Shell>
  );
}

export function App({ route }: { route: Route }) {
  switch (route.page) {
    case "ask":
      return <AskPage org={route.org} />;
    case "track":
      return <TrackPage org={route.org} token={route.token} />;
    case "partner":
      return <PartnerPage org={route.org} token={route.token} />;
    case "desk":
      return <DeskPage org={route.org} />;
    case "org":
      return (
        <Suspense fallback={<OrgLoading />}>
          <OrgPage org={route.org} />
        </Suspense>
      );
    case "join":
      return <JoinPage org={route.org} />;
    default:
      return <NotFound />;
  }
}

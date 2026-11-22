import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { matchRoute, themeFor } from "./router.js";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";

const route = matchRoute(window.location.pathname);
const theme = themeFor(route);
document.documentElement.dataset.theme = theme;
if (theme === "paper") document.documentElement.dataset.density = "comfortable";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no root element.");
createRoot(root).render(
  <StrictMode>
    <App route={route} />
  </StrictMode>,
);

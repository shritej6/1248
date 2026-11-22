import { rehearse } from "@vision/core";
import { rehearsalInput } from "./rehearsalInput.js";

self.onmessage = (event: MessageEvent<{ seed: number }>) => {
  self.postMessage(rehearse(rehearsalInput(event.data.seed)));
};

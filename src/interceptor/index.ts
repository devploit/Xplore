import { patchFetch, patchXhr, type Post } from "./capture";
import { installRouterCapture, listenForNavigate } from "./router-capture";

// MAIN world, document_start. Observes X's GraphQL traffic and forwards it to the sidebar.
// Makes no requests of its own and never reads cookies.
const post: Post = (msg) => {
  try {
    window.postMessage(msg, window.location.origin);
  } catch {
    // Structured clone can fail on exotic payloads; drop silently.
  }
};

try {
  patchFetch(window, post);
  patchXhr(window, post);
  installRouterCapture(window);
  listenForNavigate(window);
} catch {
  // Observation must never break X.
}

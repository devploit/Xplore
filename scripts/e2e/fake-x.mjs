import { createServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Fake X: an HTTPS server that answers a handful of GraphQL operations with fixtures, plus a CONNECT
// proxy so a headless Chrome started with --proxy-server reaches it as https://x.com. Used by smoke.mjs.
const here = dirname(fileURLToPath(import.meta.url));
const certDir = join(here, ".certs");
if (!existsSync(join(certDir, "cert.pem"))) {
  execSync(`mkdir -p "${certDir}" && openssl req -x509 -newkey rsa:2048 -nodes -subj "/CN=x.com" -addext "subjectAltName=DNS:x.com,DNS:twitter.com" -keyout "${certDir}/key.pem" -out "${certDir}/cert.pem" -days 2 2>/dev/null`);
}

const tweet = (id, userId, screenName, legacy = {}) => ({
  __typename: "Tweet", rest_id: id,
  core: { user_results: { result: { __typename: "User", rest_id: userId, core: { created_at: "Tue Mar 01 12:00:00 +0000 2016", name: `Name ${screenName}`, screen_name: screenName }, legacy: { followers_count: 1200, friends_count: 300, statuses_count: 5400 } } } },
  views: { count: "1500" },
  legacy: { bookmark_count: 2, created_at: new Date(Date.now() - Number(id) * 86400000).toUTCString().replace(",", ""), conversation_id_str: id, entities: { hashtags: [], urls: [], user_mentions: [] }, favorite_count: 30 + Number(id), full_text: `tweet ${id} from fake X`, is_quote_status: false, lang: "en", quote_count: 1, reply_count: 4, retweet_count: 5, user_id_str: userId, id_str: id, ...legacy },
});
const item = (id, result) => ({ entryId: `tweet-${id}`, sortIndex: "1", content: { entryType: "TimelineTimelineItem", itemContent: { itemType: "TimelineTweet", tweet_results: { result } } } });
const cursor = (v) => ({ entryId: `cursor-bottom`, content: { entryType: "TimelineTimelineCursor", value: v, cursorType: "Bottom" } });
const timeline = (entries) => ({ data: { user: { result: { __typename: "User", timeline_v2: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } } } } });

const requests = [];
const server = createServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (req, res) => {
  const url = new URL(req.url, "https://x.com");
  requests.push({ method: req.method, path: url.pathname, csrf: req.headers["x-csrf-token"], auth: (req.headers.authorization || "").slice(0, 12) });
  if (url.pathname === "/__requests") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(requests)); }
  if (url.pathname.startsWith("/i/api/graphql/")) {
    const op = url.pathname.split("/").pop();
    const vars = JSON.parse(url.searchParams.get("variables") || "{}");
    res.setHeader("content-type", "application/json");
    res.setHeader("x-rate-limit-limit", "50"); res.setHeader("x-rate-limit-remaining", "45"); res.setHeader("x-rate-limit-reset", String(Math.floor(Date.now() / 1000) + 900));
    if (op === "UserTweets" || op === "UserTweetsAndReplies") {
      const page = vars.cursor ? [item("3", tweet("3", "42", "me")), item("4", tweet("4", "42", "me", { in_reply_to_status_id_str: "3" }))] : [item("1", tweet("1", "42", "me")), item("2", tweet("2", "42", "me")), cursor("C2")];
      return res.end(JSON.stringify(timeline(page)));
    }
    if (op === "UserByScreenName" || op === "UserByRestId") return res.end(JSON.stringify({ data: { user: { result: tweet("9", "42", "me").core.user_results.result } } }));
    if (op === "SearchTimeline") return res.end(JSON.stringify({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [item("77", tweet("77", "7", "friend", { in_reply_to_user_id_str: "42", in_reply_to_status_id_str: "1" }))] }] } } } } }));
    res.statusCode = 404; return res.end(JSON.stringify({ errors: [{ message: "unknown op" }] }));
  }
  res.setHeader("content-type", "text/html");
  res.setHeader("set-cookie", ["twid=u%3D42; Path=/", "ct0=CSRFTOKEN; Path=/"]);
  res.end(`<!doctype html><html><head><title>Fake X</title></head><body style="background-color: rgb(0, 0, 0);">
  <main role="main"><div data-testid="primaryColumn">fake x</div><div data-testid="sidebarColumn">right column</div></main>
  <script>
    // Simulates X's own client: fetch via fetch() and via XHR, both GraphQL.
    fetch("/i/api/graphql/OBSERVED_ID/UserTweets?variables=%7B%22userId%22%3A%2242%22%7D&features=%7B%22obs%22%3Atrue%7D").then(r => r.json()).then(j => { window.__xJson = j; });
    const x = new XMLHttpRequest(); x.open("GET", "/i/api/graphql/OBSERVED_SEARCH/SearchTimeline?variables=%7B%7D"); x.send();
  </script></body></html>`);
});
server.listen(8443, "127.0.0.1", () => console.log("fake x on 8443"));

// Tiny CONNECT proxy: every HTTPS tunnel Chrome opens lands on the fake X above.
import { createServer as createNet, connect } from "node:net";
const proxy = createNet((socket) => {
  socket.once("data", (head) => {
    const line = head.toString().split("\r\n")[0];
    if (line.startsWith("CONNECT")) {
      const upstream = connect(8443, "127.0.0.1", () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); upstream.pipe(socket); socket.pipe(upstream); });
      upstream.on("error", () => socket.destroy());
    } else socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  socket.on("error", () => undefined);
});
proxy.listen(8080, "127.0.0.1", () => console.log("proxy on 8080"));

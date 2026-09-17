import type { TweetRow } from "@/data/db";

/** Renders tweet text as text nodes with links for URLs, mentions and hashtags. Never uses innerHTML. */
export function TweetText({ tweet }: { tweet: TweetRow }) {
  const parts: preact.ComponentChildren[] = [];
  const re = /(https?:\/\/\S+|@\w{1,15}|#\w+)/g;
  let last = 0;
  const text = tweet.full_text;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const token = m[0];
    let href = token;
    if (token.startsWith("@")) href = `https://x.com/${token.slice(1)}`;
    else if (token.startsWith("#")) href = `https://x.com/hashtag/${encodeURIComponent(token.slice(1))}`;
    parts.push(
      <a key={idx} href={href} target="_blank" rel="noopener noreferrer" class="text-sky-500 hover:underline">
        {token}
      </a>,
    );
    last = idx + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span class="whitespace-pre-wrap break-words">{parts}</span>;
}

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useMemo } from "react";

/**
 * Streaming-friendly markdown.
 *
 * Problem: mid-stream text frequently ends inside a fenced code block
 * (e.g. "```python\ndef " with no closing fence yet), which makes
 * react-markdown render the rest of the message as gibberish until the
 * closing fence arrives. We patch the source by auto-closing any odd number
 * of fences before rendering.
 */
function balanceCodeFences(src: string): string {
  // Only count triple-backtick lines to avoid miscounting inline backticks.
  const fenceCount = (src.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    return `${src}\n\`\`\``;
  }
  return src;
}

export function Markdown({ content }: { content: string }) {
  const patched = useMemo(() => balanceCodeFences(content), [content]);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      >
        {patched}
      </ReactMarkdown>
    </div>
  );
}

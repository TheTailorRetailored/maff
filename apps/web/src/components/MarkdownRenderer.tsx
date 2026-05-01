import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"

export function MarkdownRenderer({ body }: { body: string }) {
  return <article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{body}</ReactMarkdown></article>
}


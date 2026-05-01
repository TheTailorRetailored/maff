export function parseWikiLink(value: string) {
  const inner = value.replace(/^\[\[/, "").replace(/\]\]$/, "")
  const [target, alias] = inner.split("|").map((s) => s.trim())
  return { target, alias }
}

export function extractWikilinks(text: string) {
  const links = new Set<string>()
  const re = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    links.add(parseWikiLink(`[[${match[1]}]]`).target)
  }
  return [...links]
}

export function asWikilink(title: string) {
  return `[[${title}]]`
}


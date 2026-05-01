import { useEffect, useState } from "react"
import { useApi } from "../api/client"

export function Skills() {
  const { request } = useApi()
  const [skills, setSkills] = useState<string[]>([])
  useEffect(() => { request<string[]>("/skills").then(setSkills) }, [])
  return <section className="page"><header><h1>Skills</h1></header><div className="stack">{skills.map((s) => <div className="row" key={s}>{s}</div>)}</div></section>
}


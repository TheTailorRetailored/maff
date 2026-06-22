import React from "react"
import ReactDOM from "react-dom/client"
import { MaffAuthProvider } from "./auth/auth0Provider"
import { App } from "./App"
import { DemoApp } from "./DemoApp"
import "./style.css"
import "katex/dist/katex.min.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {import.meta.env.VITE_DEMO_MODE === "true" ? (
      <DemoApp />
    ) : (
      <MaffAuthProvider>
        <App />
      </MaffAuthProvider>
    )}
  </React.StrictMode>
)

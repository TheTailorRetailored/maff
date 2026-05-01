import Lake
open Lake DSL

package «research_graph» where
  moreLeanArgs := #["-DautoImplicit=false"]

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git"

lean_lib ResearchGraph where


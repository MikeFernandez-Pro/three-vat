// The worker the worker example bakes in — the whole file. `serveVATBakes`
// answers every `bakeVATInWorker` the page sends by calling `bakeVAT` here,
// on a copy of the subtree (ADR-0026). Shared by both pages: a bake touches
// no renderer, so there is nothing about it to duplicate (ADR-0011).
import { serveVATBakes } from "three-vat";

serveVATBakes();

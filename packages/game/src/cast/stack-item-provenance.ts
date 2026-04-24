// SPDX-License-Identifier: GPL-3.0-or-later
// Cast-pipeline provenance. The canonical definition lives in
// ../stack/stack-item.ts because StackItem itself carries a
// `readonly provenance: StackItemProvenance` field; consolidating it there
// keeps snapshot serialization + Stack consumers pointing at one type.
// SP2 Task 35 extended the shape in place with the cast-pipeline-populated
// optional fields (faceChosen, modesChosen, xValue); this module re-exports
// it so cast/-scoped code can import from its own barrel for discoverability.
export type { StackItemProvenance } from "../stack/stack-item.js";

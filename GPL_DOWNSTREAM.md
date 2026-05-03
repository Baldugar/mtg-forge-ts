# GPL-3.0-or-later — Downstream Implications

`@mtg-forge-ts/core`, `@mtg-forge-ts/cards`, and `@mtg-forge-ts/game` are licensed under **GPL-3.0-or-later**. This document explains what that means for downstream consumers.

## Why GPL-3.0?

These packages are derivative works of [Card-Forge/forge](https://github.com/Card-Forge/forge), which is itself GPL-3.0-or-later. Per GPL terms, derivative works must use a compatible license; we kept the same one.

The card-data resources (under `forge-gui/res/cardsfolder/`) used as the source for our parser test corpus are also GPL-3.0-or-later.

## What this means in practice

### ✅ Allowed without restriction

- **Use the packages internally** in your company, project, or product. GPL doesn't trigger on private use.
- **Run the engine in a SaaS product** where end-users interact only over the network. The AGPL has the SaaS clause; GPL-3.0 does not. You can build commercial SaaS on top of these packages without distributing source.
- **Sell software** that links these packages. GPL allows commercial use; the only thing it constrains is *distribution* terms.
- **Modify the source** for your own use without sharing the changes (if you don't distribute the modified version).

### ⚠️ Triggers GPL distribution requirements

If you **distribute** software that links against these packages — for example as a binary, a desktop installer, an Electron app, a npm package depending on us, or shipping our compiled output to end users — that software (the parts that link to ours) must:

- Be licensed under a GPL-3.0-compatible license.
- Have its source code made available to recipients (typical compliance: a `LICENSE` file plus a README pointer to the public source repo).

### "Linking" in JavaScript

Whether a JS dependency triggers GPL in your codebase depends on how you bundle and distribute. The conservative rule of thumb: if your shipped artifact contains code from `@mtg-forge-ts/*`, treat that artifact as a derivative work for distribution purposes.

If you want a clean separation, run the engine as an out-of-process service that your product communicates with over IPC / HTTP / sockets — that's typically considered an arms-length boundary by GPL FAQ, similar to the way Unix tools interact via pipes without infecting each other's licenses.

## What this is *not*

- **Not AGPL.** The "Affero" clause that triggers on network use does not apply here.
- **Not non-commercial.** GPL allows commercial use; license fees, paid support, and proprietary integrations of GPL-compatible kind are all fine.
- **Not legal advice.** The above is a plain-language summary. For commercial product decisions consult a lawyer familiar with open-source licensing.

## Magic: The Gathering

`Magic: The Gathering` is a trademark of Wizards of the Coast LLC. This project is unofficial and not affiliated with WotC. Card data is intentionally distributed as game-rules text, which courts have generally held is not subject to copyright (the rules of a game are functional). Card art and trademarks are not redistributed by this project.

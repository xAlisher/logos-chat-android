<!--
Security fix? Do not describe the vulnerability here until it is public.
Coordinate first: https://github.com/xAlisher/peers/security/advisories/new
-->

## What this changes

<!-- One or two sentences. What does it do, not how. -->

Closes #

## How it was tested

<!--
Be specific — this project's standard (PROJECT_KNOWLEDGE.md §8) is:
"A headless proof is not a device proof. Always include a negative control where possible.
Watch for tests that pass vacuously."

Say what you actually ran and on what. If you could not test a path, say so plainly.
-->

- [ ] `npm run test:logic`
- [ ] `npx tsc --noEmit`
- [ ] `cd android && ./gradlew testDebugUnitTest`
- [ ] Tested on a device — model / Android version:
- [ ] Not device-tested (say why):

<!-- If this touches Bluetooth mesh or LoRa, state whether real radios were involved. -->

## Anything reviewers should look at closely

<!--
Decisions you are unsure about, alternatives you rejected, anything you would challenge if
you were reviewing this.
-->

## Checklist

- [ ] One concern per PR
- [ ] Docs updated if behaviour changed — including `docs/privacy.md` if this changes what
      leaves the device
- [ ] No checked-in `.so` was hand-edited
- [ ] Commit messages follow the existing convention (see CONTRIBUTING.md)

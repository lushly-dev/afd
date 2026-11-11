---
'@lushly-dev/specimen': minor
---

Fail a retained story on an uncaught error or unhandled rejection, from when its module loads until its last check, with a new `error` failure category naming the message. Storybook's Vitest addon fails the run on the same errors, so a suite moved to Specimen keeps the check. As under Vitest, an event with no error value and any event of a kind the page listens for itself do not count. A story that passed while raising such an error now fails.

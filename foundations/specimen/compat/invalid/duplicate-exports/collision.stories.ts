// Two exports of one file with the same id: Storybook's index keeps the first silently.
export default { title: 'Invalid/Collision' };
export const Primary = {};
export const primary = {};

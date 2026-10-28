import { defineMain } from '@storybook/react-vite/node';

export default defineMain({
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-a11y'],
});

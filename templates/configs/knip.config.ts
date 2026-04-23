import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  project: ['src/**/*.ts'],
  ignore: [],
  ignoreBinaries: ['bats', 'shellcheck'],
  ignoreDependencies: [],
  exclude: ['exports', 'types', 'enumMembers'],
};

export default config;

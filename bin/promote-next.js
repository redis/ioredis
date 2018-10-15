#!/usr/bin/env node

'use strict';

const assert = require('assert');
const semver = require('semver');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

(async () => {
  const trim = ({ stderr, stdout }) => {
    assert(stderr === '');
    return stdout.trim();
  };

  try {
    const next = await exec('npm view ioredis@next version').then(trim);
    const current = await exec('npm view ioredis@latest version').then(trim);

    if (semver.gt(next, current) === false) {
      console.info(`Current is ${current}, next is ${next}`);
      return;
    }

    console.info(await exec(`npm dist-tag add ioredis@${next} latest`).then(trim));
  } catch (e) {
    console.error('Failed', e);
    throw e;
  }
})();

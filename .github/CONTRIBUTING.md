# Contributing to this repository

Thanks for contributing to ioredis! 👏

The goal of ioredis is to become a Redis client that is delightful to work with. It should have a full feature set, easy-to-use APIs, and high performance.

Nowadays, it is one of the most popular Redis clients, and more and more people are using it. That's why we are welcoming more people to contribute to ioredis to make it even better! 👍


## User Roles

There are two user roles: contributors and collaborators. Everyone becomes a contributor when they are creating issues, pull requests, or helping to review code.

In the meantime, there is a group of collaborators of ioredis who can not only contribute code but also approve and merge others' pull requests.

## Note to collaborators

Thank you for being a collaborator (which means you have already contributed amazing code so thanks again)! As a collaborator, you have the following permissions:

1. Approve pull requests.
2. Merge pull requests.

Considering ioredis has been used in a great many serious codebases, we must be careful with code changes. In this repository, at least one approval is required for each pull request to be merged.

ioredis uses [semantic-release](https://github.com/semantic-release/semantic-release). Every commit to the master branch will trigger a release automatically. To get a helpful changelog and make sure the version is correct, we adopt AngularJS's convention for commit message format. Please read more here: https://github.com/semantic-release/semantic-release#commit-message-format

We prefer a linear Git history, so when merging a pull request, we should always go with squash, and update the commit message to fit our convention (simply put, prefix with `feat: ` for features, `fix: ` for fixes, `refactor: ` for refactors, and `docs: ` for documentation changes).

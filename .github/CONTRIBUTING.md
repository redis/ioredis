# Contributing to this repository

Thanks for contributing to ioredis! 👏

The goal of ioredis is to become a Redis client that is delightful to work with. It should have a full feature set, easy-to-use APIs, and high performance.

Nowadays, it is one of the most popular Redis clients, and more and more people are using it. That's why we are welcoming more people to contribute to ioredis to make it even better! 👍

## Contribution guide

ioredis is released under the [MIT license](../LICENSE). This guide covers reporting issues, submitting changes, and reviewing pull requests.

### Code of conduct

Please follow the [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md), which also explains how to report unacceptable behavior.

### Using GitHub issues

We use [GitHub issues](https://github.com/redis/ioredis/issues) to track bugs and feature requests. Search existing issues before opening a new one. For usage questions, start with the documentation linked below.

Report security vulnerabilities through [SECURITY.md](../SECURITY.md).

### Before starting work

Before starting work, share your proposed change with the maintainers so we can agree on the scope and approach. This helps reduce the need for substantial revisions during review.

For most changes, find an existing GitHub issue or open one describing the problem and your proposed approach. Follow the guidance for [bug reports](#bug-reports) or [feature requests](#feature-requests). Before writing code, wait for a maintainer to comment on the issue confirming that you can proceed with the approach. The pull request will still need to pass code review.

You can submit a pull request directly for:

- Spelling or grammar corrections in documentation or comments.
- Brief documentation updates that clarify existing behavior.
- Small, isolated bug fixes where the cause and solution are clear and a focused test demonstrates the fix.

New features, API changes, refactors, performance improvements, and broader behavior changes need an issue discussion first. If you are unsure whether your change needs discussion, open an issue and we can help define the scope.

For changes that need prior discussion, we may pause review if the pull request has no linked issue with a maintainer's go-ahead. We will ask you to discuss the approach in an issue before continuing.

### Submitting a Pull Request

Once a maintainer has agreed to the approach, or your change falls under the exceptions above:

1. Fork the ioredis repository.
2. Clone your fork and `cd` into the repository.
3. Install Node.js and npm. Use a Node.js version listed in [the test workflow](workflows/test_with_cov.yml).
4. Run `npm install` to install dependencies.
5. Create a branch for your changes from `main`.
6. Implement your changes, add dedicated tests, and update any affected documentation.
7. Run `npm run lint`, `npm run build`, and the tests for your change. See [Testing](#testing) for Redis setup and test commands.
8. Push your branch to your fork and open a pull request against `main`. You can open it as a draft while work is in progress.
9. Link the relevant issue in the pull request description, if there is one. Use `Closes #123` if the change resolves that issue. Describe the change and the tests you ran.
10. When the changes are complete and checks pass, mark the pull request as ready for review.

### Bug reports

Search existing GitHub issues before reporting a bug. If no open issue covers the problem, create a new one. Open a new issue instead of commenting on a closed one, where your report may go unnoticed. Link any related issues.

Use a concise title and include:

- Your ioredis, Node.js, and Redis versions.
- What you were trying to do, including whether you use standalone Redis, Sentinel, or Cluster.
- Expected and actual behavior, with relevant errors.
- The smallest complete example that reproduces the problem and the steps to run it. A failing test is welcome but not required.
- Debug logs from running your example with `DEBUG=ioredis:*` enabled. These are optional but can help diagnose the problem.

Remove credentials and private data from examples and logs.

### Feature requests

For new features and public API changes, open a GitHub issue before writing code or creating a pull request. Explain your use cases so maintainers can discuss whether the proposal is a good fit for ioredis.

When requesting a feature, please include:

- What you want to achieve.
- What you were trying to do with ioredis and why existing functionality does not meet your needs.
- Optionally, your ideas for how to implement the feature.

### Questions

If you have a question, check the documentation first. GitHub issues are for bug reports and feature requests; use the community channels below for usage questions and general discussion.

**Check the docs**

- [README](../README.md)
- [API documentation](https://redis.github.io/ioredis/)
- [Examples](../examples)

**Communication**

- [Stack Overflow](https://stackoverflow.com/questions/tagged/ioredis): questions tagged `ioredis`.
- [Redis Discord](https://discord.gg/redis): community chat and questions.
- [Redis on Twitter](https://twitter.com/redisinc): news and updates.
- [GitHub Issues](https://github.com/redis/ioredis/issues): bug reports and feature requests.

### Testing

The provided test environment requires Docker with Docker Compose. It starts standalone Redis on port `6379` and a six-node Cluster on ports `3000`–`3005`:

```bash
npm run docker:setup
npm test
npm run test:cluster
npm run docker:teardown
```

Use dedicated Redis instances: the tests clear data and close connections. Teardown removes the test containers and their volumes.

Place unit tests in `test/unit/`, functional tests in `test/functional/`, tests against the running Cluster in `test/cluster/`, and TypeScript declaration tests in `test/typing/`. Follow nearby tests and reuse helpers from `test/helpers/`.

`npm test` runs unit, functional, and declaration tests. See [the test workflow](workflows/test_with_cov.yml) for the Node.js and Redis versions used in CI.

### Commit messages and releases

Use squash merge to keep a linear Git history. The final commit message should follow the format `<type>: <subject>`, with `feat:` for features, `fix:` for fixes, `refactor:` for refactors, and `docs:` for documentation changes.

ioredis uses [semantic-release](https://github.com/semantic-release/semantic-release) through the manually triggered [release workflow](workflows/release.yml). It analyzes commit messages to decide whether a release is needed, determine the version, and generate the changelog. See the [commit message format](https://github.com/semantic-release/semantic-release#commit-message-format) for details.

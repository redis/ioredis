[ -z "$CONVENTIONAL_GITHUB_RELEASER_TOKEN" ] && echo "Need to set Token" && exit 1;
cp package.json _package.json &&
bump=`conventional-recommended-bump -p angular` &&
echo ${1:-$bump} &&
npm --no-git-tag-version version ${1:-$bump} &>/dev/null &&
conventional-changelog -i Changelog.md -s -p angular &&
git add Changelog.md &&
version=`cat package.json | json version` &&
git commit -m"docs(CHANGELOG): $version" &&
mv -f _package.json package.json &&
npm version ${1:-$bump} -m "chore(release): %s" &&
git push --follow-tags &&
conventional-github-releaser -p angular &&
npm publish
